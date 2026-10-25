"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { notifyUser } from "@/lib/notify";
import { sendMail } from "@/lib/mailer";
import { renderCampaignClosedEmail, renderCampaignsClosedEmail } from "@/lib/email-templates";
import { renderSuggestionsHtml, renderSuggestionsText, suggestCampaignsForCreator } from "@/lib/campaign-suggestions";
import { buildEndedCampaignSweep, type SweepCreator, type SweepPlan } from "@/lib/campaign-sweep";
import { CLOSED_AFFECTED } from "../[id]/campaign-transition-constants";
import { SWEEP_NOTIFY_CHUNK } from "./sweep-constants";

/** Read-only: what a sweep would do. Safe to call as often as you like. */
export async function prepareEndedSweep(): Promise<SweepPlan> {
  const gate = await adminGate();
  if (gate)
    return {
      error: gate.error,
      campaignsToComplete: [],
      endedCampaignIds: [],
      campaignsWithUndecided: 0,
      applicationIds: [],
      creators: [],
      unreachable: 0,
    };
  return buildEndedCampaignSweep(createAdminClient());
}

export type SweepApplied = {
  error?: string;
  campaignsCompleted?: number;
  applicationsClosed?: number;
  /** Who to tell, derived from what was ACTUALLY closed. */
  creators?: SweepCreator[];
  unreachable?: number;
};

/**
 * Close the applications and mark the campaigns completed.
 *
 * The plan is REBUILT here rather than taken from the client. The preview
 * the admin looked at is a screenshot of a moment; between then and the
 * click someone may have approved an applicant, and the one thing this must
 * never do is close an application that stopped being undecided. Rebuilding
 * also means the returned creator list describes what was really closed, so
 * nobody is emailed about an application that was left alone.
 *
 * The two writes are batched, not per campaign: 43 campaigns and 458 rows
 * are two statements, and a half-applied sweep is the state worth avoiding.
 *
 * Campaigns are completed BEFORE anyone is told, which matters more than it
 * looks: suggestCampaignsForCreator only offers `active` campaigns, so this
 * ordering is what stops the email recommending the very campaign it is
 * writing to say has finished.
 */
export async function applyEndedSweep(): Promise<SweepApplied> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const admin = createAdminClient();
  const plan = await buildEndedCampaignSweep(admin);
  if (plan.error) return { error: plan.error };
  if (plan.applicationIds.length === 0 && plan.campaignsToComplete.length === 0) {
    return { campaignsCompleted: 0, applicationsClosed: 0, creators: [], unreachable: 0 };
  }

  const nowIso = new Date().toISOString();

  let campaignsCompleted = 0;
  if (plan.campaignsToComplete.length > 0) {
    const { data, error } = await admin
      .from("campaigns")
      .update({ status: "completed", updated_at: nowIso })
      .in("campaign_id", plan.campaignsToComplete)
      .select("campaign_id");
    if (error) {
      return { error: friendlyDbError("sweep.campaigns", error, "Could not update the campaigns.") };
    }
    campaignsCompleted = data?.length ?? 0;
  }

  // Scoped to the ended campaigns AND re-checked against the undecided
  // statuses, so a row approved since the plan was built is not swept up.
  let applicationsClosed = 0;
  if (plan.endedCampaignIds.length > 0) {
    const { data, error } = await admin
      .from("campaign_applications")
      .update({ status: "closed", updated_at: nowIso })
      .in("campaign_id", plan.endedCampaignIds)
      .in("status", CLOSED_AFFECTED as unknown as string[])
      .select("id");
    if (error) {
      // The campaigns are already completed. That half is reported rather
      // than rolled back — it is correct on its own and is what stops the
      // drift rebuilding.
      logError("sweep.applications", error, { campaigns: plan.endedCampaignIds.length });
      return {
        error: friendlyDbError("sweep.applications", error, "Campaigns were updated, but the applications were not."),
        campaignsCompleted,
      };
    }
    applicationsClosed = data?.length ?? 0;
  }

  await auditLog(
    "campaigns_ended_sweep",
    actorId,
    `${campaignsCompleted} campaigns completed, ${applicationsClosed} applications closed, ${plan.creators.length} creators to notify`,
  );
  revalidatePath("/dashboard/campaigns");

  return { campaignsCompleted, applicationsClosed, creators: plan.creators, unreachable: plan.unreachable };
}

export type SweepNotifyResult = {
  influencerId: string;
  name: string;
  campaigns: number;
  email: "sent" | "skipped" | "failed";
  notification: "sent" | "failed";
  error?: string;
};

/**
 * Tell one chunk of creators — ONE message each, however many of their
 * applications closed.
 *
 * Nothing the caller sends is used as content. The ids are re-read here:
 * the name and address come from the profile row and the campaign titles
 * from the applications themselves, so a tampered payload can at worst ask
 * for a message that is already true, addressed to the person it concerns.
 *
 * Each channel is independent. An SMTP failure must not cost someone their
 * in-app notification, and 38% of these creators have no address at all, so
 * "skipped" is an expected outcome rather than a fault.
 */
export async function notifyEndedSweepChunk(
  entries: { influencerId: string; applicationIds: string[] }[],
): Promise<{ error?: string; results?: SweepNotifyResult[] }> {
  const gate = await adminGate();
  if (gate) return { error: gate.error };
  if (!entries?.length) return { results: [] };
  if (entries.length > SWEEP_NOTIFY_CHUNK) {
    return { error: `Notify at most ${SWEEP_NOTIFY_CHUNK} creators at a time.` };
  }

  const admin = createAdminClient();
  const allAppIds = entries.flatMap((e) => e.applicationIds).slice(0, SWEEP_NOTIFY_CHUNK * 40);
  const ids = entries.map((e) => e.influencerId);

  const [{ data: apps }, { data: profiles }] = await Promise.all([
    admin
      .from("campaign_applications")
      .select("id, influencer_id, campaign_id, status, campaigns(title)")
      .in("id", allAppIds),
    admin.from("influencer_profiles").select("influencer_id, full_name, username, instagram_handle, email").in("influencer_id", ids),
  ]);

  const profileOf = new Map((profiles || []).map((p) => [p.influencer_id, p]));
  const titlesOf = new Map<string, Set<string>>();
  for (const a of apps || []) {
    // Only talk about rows that really did close, and only to the creator
    // they belong to.
    if (a.status !== "closed" || !a.influencer_id) continue;
    if (!titlesOf.has(a.influencer_id)) titlesOf.set(a.influencer_id, new Set());
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const title = (a as any).campaigns?.title || "a campaign";
    titlesOf.get(a.influencer_id)!.add(title);
  }

  const results = await Promise.all(
    entries.map(async (entry): Promise<SweepNotifyResult> => {
      const p = profileOf.get(entry.influencerId);
      const name = p?.full_name || p?.username || p?.instagram_handle || "Creator";
      const titles = [...(titlesOf.get(entry.influencerId) || [])].sort();
      let email: SweepNotifyResult["email"] = "skipped";
      let notification: SweepNotifyResult["notification"] = "failed";
      let error: string | undefined;

      if (titles.length === 0) {
        return {
          influencerId: entry.influencerId,
          name,
          campaigns: 0,
          email: "skipped",
          notification: "failed",
          error: "Nothing closed for this creator",
        };
      }

      if (p?.email) {
        try {
          const suggestions = await suggestCampaignsForCreator(admin, entry.influencerId, { limit: 3 });
          const suggestionsHtml = renderSuggestionsHtml(suggestions);
          const suggestionsText = renderSuggestionsText(suggestions);
          // One campaign keeps the richer existing template; several need
          // the list form, since there is no single banner or brand.
          const mail =
            titles.length === 1
              ? renderCampaignClosedEmail({
                  fullName: name,
                  campaignTitle: titles[0],
                  suggestionsHtml,
                  suggestionsText,
                  bannerUrl: null,
                  brandLogoUrl: null,
                  brandName: "RGossips",
                })
              : renderCampaignsClosedEmail({ fullName: name, campaignTitles: titles, suggestionsHtml, suggestionsText });
          await sendMail({ to: p.email, subject: mail.subject, html: mail.html, text: mail.text, fromName: "RGossips" });
          email = "sent";
        } catch (e) {
          email = "failed";
          error = e instanceof Error ? e.message : "Email failed";
          logError("sweep.email", e, { influencerId: entry.influencerId });
        }
      }

      // notifyUser never throws — it logs and returns false — so the result
      // is what has to be read.
      const ok = await notifyUser(
        {
          userId: entry.influencerId,
          // Deliberately not an app_* type: those route to an offer page
          // expecting a live application. An unknown type degrades to a
          // generic bell in the consumer app, so this is safe to ship from
          // the portal alone.
          type: "campaign_closed",
          title: titles.length === 1 ? "A campaign you applied to has closed" : "Some campaigns you applied to have closed",
          body: {
            text:
              titles.length === 1
                ? `"${titles[0]}" has finished, so we've closed your application. It isn't a rejection — have a look at what else is open.`
                : `${titles.length} campaigns you applied to have finished, so we've closed those applications. It isn't a rejection — have a look at what else is open.`,
            link: "/influencer/offers",
          },
        },
        "campaign-closed-sweep",
      );
      notification = ok ? "sent" : "failed";
      if (!ok) error = error || "Notification could not be saved";

      return { influencerId: entry.influencerId, name, campaigns: titles.length, email, notification, error };
    }),
  );

  return { results };
}
