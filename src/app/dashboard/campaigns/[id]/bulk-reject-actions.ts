"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin } from "@/lib/require-super-admin";
import { auditLog, enforceRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { clampLen } from "@/lib/validation";
import { notifyUser } from "@/lib/notify";
import { sendAdminApplicationStatusEmails } from "@/lib/application-emails";
import { APPLICATION_NOTIFICATIONS } from "@/app/dashboard/campaigns/application-notifications";

// Rejecting a whole group of applicants in one go.
//
// Deliberately NOT a loop over updateApplicationStatus, for two reasons.
//
//  1. That action emails BOTH sides. Rejecting twenty applicants through it
//     would send the brand twenty near-identical emails about a decision
//     they did not make. Here each creator is told — they are waiting on an
//     answer and deserve one — and the brand is not emailed at all, because
//     clearing out under-spec applicants is housekeeping on their behalf,
//     not news. That is the one behavioural difference from a single reject,
//     and the UI says so before you press it.
//  2. It re-reads the application and the campaign per call. One batched
//     read and one batched update keeps a 200-row reject inside the
//     function timeout.
//
// Everything else is the same contract: only an admin, only statuses that
// have not been decided yet, and the ids are re-read server-side rather
// than trusted.

// The only statuses a bulk reject may touch. Anything else has either been
// decided already or belongs to the creator: re-rejecting an approved
// creator who has delivered would be destructive, and `withdrawn` was their
// own choice.
const REJECTABLE = new Set(["pending", "on_hold"]);

const REASON_MAX = 500;

export type BulkRejectResult = {
  error?: string;
  rejected?: number;
  /** Ids that were sent but are no longer in a rejectable state. */
  skipped?: number;
  /** Creators we could not reach. The rejection still stands. */
  notifyFailed?: number;
};

export async function bulkRejectApplications(
  campaignId: string,
  applicationIds: string[],
  reason?: string,
): Promise<BulkRejectResult> {
  const gate = await adminGate();
  if (gate) return gate;

  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const ids = [...new Set((applicationIds || []).filter(Boolean))];
  if (!ids.length) return { rejected: 0 };
  if (ids.length > 200) return { error: "Too many applications in one go — select at most 200." };

  // This sends one email and one push per creator, so it is abuse-prone in
  // the same way the manual invite emails are. A handful of batches an hour
  // is plenty for housekeeping and nowhere near enough to spam the base.
  const rl = await enforceRateLimit({
    action: "bulk_reject_applications",
    actorId,
    limit: 10,
    windowSec: 60 * 60,
  });
  if (!rl.allowed) {
    return { error: "You have done several bulk rejections this hour. Please wait a bit before the next one." };
  }

  const admin = createAdminClient();
  const clean = clampLen(reason || "", REASON_MAX);

  // Re-read server-side, scoped to THIS campaign. A stale list or a tampered
  // payload must not be able to reject an application on another campaign.
  const { data: rows, error: readErr } = await admin
    .from("campaign_applications")
    .select(
      "id, status, influencer_id, campaign_id, campaigns(title, brand_id, brand_profiles(brand_name), brand_invitations(brand_name)), influencer_profiles(full_name, username, instagram_handle)",
    )
    .eq("campaign_id", campaignId)
    .in("id", ids);

  if (readErr) {
    logError("bulkReject.read", readErr, { campaignId, count: ids.length });
    return { error: "Could not read those applications. Please try again." };
  }

  const targets = (rows || []).filter((r) => REJECTABLE.has(String(r.status)));
  const skipped = ids.length - targets.length;
  if (!targets.length) return { rejected: 0, skipped };

  const updates: Record<string, unknown> = {
    status: "rejected",
    updated_at: new Date().toISOString(),
  };
  if (clean) updates.rejection_reason = clean;

  const { error: writeErr } = await admin
    .from("campaign_applications")
    .update(updates)
    .eq("campaign_id", campaignId)
    .in(
      "id",
      targets.map((t) => t.id),
    );

  if (writeErr) {
    logError("bulkReject.write", writeErr, { campaignId, count: targets.length });
    return { error: "Could not reject those applications. Nothing was changed." };
  }

  // Money-adjacent enough to record: this closes the door on people who
  // applied, and the acting admin should be on the record for it.
  await auditLog(
    "applications_bulk_reject",
    actorId,
    `${campaignId}: ${targets.length} rejected${clean ? ` — ${clean}` : ""}`,
  );

  // ── Tell each creator ──────────────────────────────────────────────────
  //
  // Best-effort and AFTER the write, exactly like the single-application
  // path: the decision is committed, and a creator we cannot email is not a
  // reason to leave them wondering forever in a pending state.
  const notification = APPLICATION_NOTIFICATIONS.rejected;
  let notifyFailed = 0;

  for (const row of targets) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const camp = (row as any).campaigns;
    const creator = (row as any).influencer_profiles;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const title = camp?.title || "a campaign";

    if (notification && row.influencer_id) {
      const ok = await notifyUser(
        {
          userId: row.influencer_id,
          type: notification.type,
          title: notification.title,
          body: {
            text: notification.text(title),
            link: `/influencer/offers/${campaignId}`,
            campaignId,
            applicationId: row.id,
          },
        },
        "application-bulk-reject",
      );
      if (!ok) notifyFailed++;
    }

    try {
      await sendAdminApplicationStatusEmails({
        status: "rejected",
        campaignId,
        campaignTitle: title,
        creatorUserId: row.influencer_id,
        // Null on purpose — see the note at the top of this file. The brand
        // gets no email for a bulk reject.
        brandUserId: null,
        creatorName:
          creator?.full_name ||
          creator?.username ||
          (creator?.instagram_handle ? `@${creator.instagram_handle}` : "A creator"),
        brandName: camp?.brand_profiles?.brand_name || camp?.brand_invitations?.brand_name || "The brand",
        reason: clean || null,
      });
    } catch (e) {
      logError("bulkReject.email", e, { applicationId: row.id });
    }
  }

  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  return { rejected: targets.length, skipped, notifyFailed };
}
