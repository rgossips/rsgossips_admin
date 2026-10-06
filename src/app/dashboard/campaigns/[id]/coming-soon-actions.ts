"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { notifyUser } from "@/lib/notify";
import { sendMail } from "@/lib/mailer";
import { renderCampaignComingSoonEmail } from "@/lib/email-templates";
import {
  TRANSITION_CHUNK,
  affectedStatuses,
  campaignStatusFor,
  targetStatus,
  type TransitionMode,
} from "./campaign-transition-constants";
import { renderCampaignClosedEmail, renderCampaignReopenedEmail } from "@/lib/email-templates";
import { renderSuggestionsHtml, renderSuggestionsText, suggestCampaignsForCreator } from "@/lib/campaign-suggestions";

// Pulling a LIVE campaign back to "coming soon".
//
// Marking a brand-new campaign coming-soon is nothing: nobody has applied.
// Doing it to one that is already open is different — people have put their
// name forward on something that is about to stop accepting applications,
// and leaving them on "Pending Review" against a campaign that is no longer
// open is how a creator ends up waiting on an answer that is not coming.
//
// So the move is three steps, deliberately separate:
//
//   1. prepareComingSoon  — read-only. Counts who is affected so the admin
//      sees the number BEFORE anything happens.
//   2. applyComingSoon    — flips the campaign and parks the applications in
//      one go. Fast, and it is the part that must not be half-done.
//   3. notifyComingSoonChunk — tells each creator, a few at a time, so the
//      admin watches it happen rather than staring at a spinner. SMTP is
//      slow and Netlify's function timeout is short; the same client-chunked
//      shape as bulk invite and photo enrichment.
//
// Applications are parked at `on_hold`, which is exactly what has happened
// to them: kept, not rejected. The creator-facing copy for this transition
// is campaign-specific, NOT the generic "you've been shortlisted" — nobody
// shortlisted them, the campaign was pulled back.

export type ComingSoonApplicant = {
  applicationId: string;
  influencerId: string | null;
  name: string;
  handle: string | null;
  email: string | null;
  status: string;
};

export type ComingSoonPlan = {
  error?: string;
  campaignTitle?: string;
  /** Everyone who will be notified and parked. */
  applicants?: ComingSoonApplicant[];
  /** Rows deliberately left alone (withdrawn / rejected / completed). */
  untouched?: number;
};

export async function prepareComingSoon(
  campaignId: string,
  mode: TransitionMode = "coming_soon",
): Promise<ComingSoonPlan> {
  const gate = await adminGate();
  if (gate) return { error: gate.error };

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("title")
    .eq("campaign_id", campaignId)
    .maybeSingle();

  const { data, error } = await admin
    .from("campaign_applications")
    .select("id, influencer_id, status, influencer_profiles(full_name, username, instagram_handle, email)")
    .eq("campaign_id", campaignId);
  if (error) {
    return { error: friendlyDbError("coming-soon.prepare", error, "Could not read the applications.", { campaignId }) };
  }

  const rows = data || [];
  const applicants: ComingSoonApplicant[] = [];
  let untouched = 0;
  for (const r of rows) {
    if (!affectedStatuses(mode).includes(r.status)) {
      untouched++;
      continue;
    }
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const p = (r as any).influencer_profiles;
    applicants.push({
      applicationId: r.id,
      influencerId: r.influencer_id,
      name: p?.full_name || p?.username || p?.instagram_handle || "Creator",
      handle: p?.instagram_handle || p?.username || null,
      email: p?.email || null,
      status: r.status,
    });
  }

  return { campaignTitle: campaign?.title || "this campaign", applicants, untouched };
}

/**
 * Flip the campaign and park its applications.
 *
 * Done in one action rather than per creator because this is the part that
 * must not be left half-applied: a campaign showing "Coming Soon" while its
 * applications still read "Pending Review" is worse than either state alone.
 * The notifications that follow are best-effort by comparison — a creator
 * who misses the email still has an application in the right state.
 */
export async function applyComingSoon(
  campaignId: string,
  mode: TransitionMode = "coming_soon",
  requestedStatus = "coming_soon",
): Promise<{ error?: string; success?: boolean; parked?: number }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const admin = createAdminClient();
  const { error: campErr } = await admin
    .from("campaigns")
    .update({ status: campaignStatusFor(mode, requestedStatus), updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId);
  if (campErr) {
    return { error: friendlyDbError("coming-soon.campaign", campErr, "Could not update the campaign.", { campaignId }) };
  }

  const { data: parked, error: appErr } = await admin
    .from("campaign_applications")
    .update({ status: targetStatus(mode), updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .in("status", affectedStatuses(mode) as string[])
    .select("id");
  // The campaign is already back to coming-soon, which is the half that
  // matters; a failure here is reported but does not roll that back.
  if (appErr) logError("coming-soon.applications", appErr, { campaignId });

  const verb = mode === "reopen" ? "restored" : mode === "closed" ? "closed" : "parked";
  await auditLog(
    mode === "reopen" ? "campaign_reopened" : mode === "closed" ? "campaign_closed_applications" : "campaign_coming_soon",
    actorId,
    `${campaignId}: ${parked?.length ?? 0} applications ${verb}`,
  );
  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  revalidatePath("/dashboard/campaigns");
  return { success: true, parked: parked?.length ?? 0 };
}

export type NotifyResult = {
  applicationId: string;
  name: string;
  /** sent | skipped (no address) | failed */
  email: "sent" | "skipped" | "failed";
  /** sent | failed — the in-app notification, which also pushes. */
  notification: "sent" | "failed";
  error?: string;
};

/**
 * Tell one chunk of creators. Each channel is independent: an SMTP failure
 * must not cost someone their in-app notification, and only ~15% of
 * creators have an email on file at all, so "skipped" is the common,
 * expected outcome rather than a problem.
 */
export async function notifyComingSoonChunk(
  campaignId: string,
  applicants: ComingSoonApplicant[],
  mode: TransitionMode = "coming_soon",
): Promise<{ error?: string; results?: NotifyResult[] }> {
  const gate = await adminGate();
  if (gate) return { error: gate.error };
  if (!applicants?.length) return { results: [] };
  if (applicants.length > TRANSITION_CHUNK) {
    return { error: `Send at most ${TRANSITION_CHUNK} at a time.` };
  }

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("title, description, brand_profiles(brand_name), brand_invitations(brand_name)")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  const title = campaign?.title || "a campaign you applied to";
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const camp = campaign as any;
  const brandName = camp?.brand_profiles?.brand_name || camp?.brand_invitations?.brand_name || "RGossips";
  // Same campaign for everyone in the chunk, so this is read once rather
  // than per creator.
  const SEP = "\n\n---\n";
  let bannerUrl: string | null = null;
  const rawDesc = String(camp?.description || "");
  const sepAt = rawDesc.indexOf(SEP);
  const metaJson = sepAt !== -1 ? rawDesc.slice(sepAt + SEP.length) : rawDesc.trimStart().startsWith("{") ? rawDesc : "";
  if (metaJson) {
    try {
      const meta = JSON.parse(metaJson);
      if (typeof meta?.banner_image === "string" && meta.banner_image.startsWith("http")) bannerUrl = meta.banner_image;
    } catch {
      /* a malformed trailer just means no banner */
    }
  }
  const { data: brandRow } = camp?.brand_profiles
    ? await admin.from("brand_profiles").select("logo_url").eq("brand_name", brandName).maybeSingle()
    : { data: null };
  const brandLogoUrl =
    typeof brandRow?.logo_url === "string" && brandRow.logo_url.startsWith("http") ? brandRow.logo_url : null;

  const results = await Promise.all(
    applicants.map(async (a): Promise<NotifyResult> => {
      let email: NotifyResult["email"] = "skipped";
      let notification: NotifyResult["notification"] = "failed";
      let error: string | undefined;

      if (a.email) {
        try {
          // Every creator email carries what else is open. On a closing
          // campaign that is the only useful thing left to say; on a
          // coming-soon one it keeps them busy until it reopens. Computed
          // per creator because the list is filtered to what THEY can apply
          // to — a suggestion they are not eligible for is worse than none.
          const suggestions = await suggestCampaignsForCreator(admin, a.influencerId, {
            limit: 3,
            excludeCampaignId: campaignId,
          });
          const suggestionsHtml = renderSuggestionsHtml(suggestions);
          const suggestionsText = renderSuggestionsText(suggestions);
          const mail =
            mode === "reopen"
              ? renderCampaignReopenedEmail({ fullName: a.name, campaignTitle: title, suggestionsHtml, suggestionsText, bannerUrl, brandLogoUrl, brandName })
              : mode === "closed"
              ? renderCampaignClosedEmail({ fullName: a.name, campaignTitle: title, suggestionsHtml, suggestionsText, bannerUrl, brandLogoUrl, brandName })
              : renderCampaignComingSoonEmail({ fullName: a.name, campaignTitle: title, suggestionsHtml, suggestionsText, bannerUrl, brandLogoUrl, brandName });
          await sendMail({ to: a.email, subject: mail.subject, html: mail.html, text: mail.text, fromName: "RGossips" });
          email = "sent";
        } catch (e) {
          email = "failed";
          error = e instanceof Error ? e.message : "Email failed";
          logError("coming-soon.email", e, { applicationId: a.applicationId });
        }
      }

      if (a.influencerId) {
        // notifyUser never throws — it logs and returns false — so the
        // result is what has to be read. A try/catch here would always
        // report success.
        const ok = await notifyUser(
          {
            userId: a.influencerId,
            // Not an app_* type: those route to the offer page expecting a
            // live application. This is campaign news, and an unknown type
            // degrades to a generic bell in the consumer app, so it is safe
            // to ship from here alone.
            type:
              mode === "reopen"
                ? "campaign_reopened"
                : mode === "closed"
                  ? "campaign_closed"
                  : "campaign_coming_soon",
            title:
              mode === "reopen"
                ? "A campaign you applied to is open again"
                : mode === "closed"
                  ? "A campaign you applied to has closed"
                  : "A campaign you applied to is being prepared",
            body: {
              text:
                mode === "reopen"
                  ? `"${title}" is taking applications again. Applications were cleared while it was being prepared, so apply again to put your name forward.`
                  : mode === "closed"
                  ? `"${title}" has finished, so we've closed your application. It isn't a rejection — have a look at what else is open.`
                  : `"${title}" isn't open for applications right now. Your application is saved — we'll tell you the moment it reopens.`,
              link: `/influencer/offers/${campaignId}`,
              campaignId,
            },
          },
          mode === "reopen" ? "campaign-reopened" : mode === "closed" ? "campaign-closed" : "campaign-coming-soon",
        );
        notification = ok ? "sent" : "failed";
        if (!ok) error = error || "Notification could not be saved";
      }

      return { applicationId: a.applicationId, name: a.name, email, notification, error };
    }),
  );

  return { results };
}
