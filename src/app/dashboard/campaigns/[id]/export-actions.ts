"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentAdminRole } from "@/lib/require-super-admin";
import { friendlyDbError, logError } from "@/lib/log";
import { auditLog } from "@/lib/rate-limit";
import type { ApplicantExportRow } from "./export-columns";

// auth.admin.getUserById is one request per creator; cap the fan-out so a
// campaign with hundreds of applicants doesn't open hundreds of sockets.
const PHONE_LOOKUP_CONCURRENCY = 10;

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

// `rejection_reason` doubles as the revision payload ({ note, links }) when
// the status is revision_needed — flatten either shape to readable text.
function reasonText(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const parts = [parsed.note, ...(Array.isArray(parsed.links) ? parsed.links : [])].filter(Boolean);
      return parts.join(" | ");
    }
  } catch { /* plain-text reason */ }
  return raw;
}

// Applicant list for the campaign detail page's Excel download. Read-only,
// so viewers may export — but it carries PII (email + phone), so the gate
// is mandatory (server actions bypass the dashboard layout) and every
// export is audit-logged.
export async function getCampaignApplicantsForExport(
  campaignId: string,
): Promise<{ error?: string; rows?: ApplicantExportRow[]; campaignTitle?: string }> {
  const { userId, role } = await getCurrentAdminRole();
  if (!userId || !["super_admin", "admin", "viewer"].includes(role || "")) {
    return { error: "This action requires admin access." };
  }
  if (!campaignId) return { error: "Missing campaign" };

  const admin = createAdminClient();

  const { data: campaign, error: campaignError } = await admin
    .from("campaigns")
    .select("title")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (campaignError) return { error: friendlyDbError("export-applicants", campaignError, undefined, { campaignId }) };
  if (!campaign) return { error: "Campaign not found" };

  // `influencer_profiles(*)` rather than a column list: optional columns
  // (gender, location, city/state) vary by environment, and naming one that
  // doesn't exist fails the whole query.
  const { data: applications, error } = await admin
    .from("campaign_applications")
    .select("*, influencer_profiles(*)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) return { error: friendlyDbError("export-applicants", error, undefined, { campaignId }) };

  // Creators sign in by phone, and phone lives on auth.users, not the profile.
  const ids = [...new Set((applications || []).map((a) => a.influencer_id).filter(Boolean))] as string[];
  const phoneMap = new Map<string, string>();
  for (let i = 0; i < ids.length; i += PHONE_LOOKUP_CONCURRENCY) {
    await Promise.all(
      ids.slice(i, i + PHONE_LOOKUP_CONCURRENCY).map(async (id) => {
        try {
          const { data } = await admin.auth.admin.getUserById(id);
          if (data?.user?.phone) phoneMap.set(id, data.user.phone);
        } catch (e) {
          // Non-fatal — the cell is just left blank.
          logError("export-applicants", e, { influencerId: id, step: "phone" });
        }
      }),
    );
  }

  const rows: ApplicantExportRow[] = (applications || []).map((app, idx) => {
    const inf = app.influencer_profiles || {};
    const handle = inf.instagram_handle || "";
    const phone = phoneMap.get(app.influencer_id);
    const location = inf.location || [inf.city, inf.state].filter(Boolean).join(", ");
    const links = Array.isArray(app.submission_links)
      ? app.submission_links.map((l: { url?: string }) => l?.url).filter(Boolean).join("\n")
      : "";
    return {
      sno: idx + 1,
      name: inf.full_name || "",
      instagram: handle ? `@${handle}` : "",
      instagramUrl: handle ? `https://instagram.com/${handle}` : "",
      email: inf.email || "",
      phone: phone ? (phone.startsWith("+") ? phone : `+${phone}`) : "",
      followers: typeof inf.followers_count === "number" ? inf.followers_count : null,
      engagementRate: typeof inf.engagement_rate === "number" ? inf.engagement_rate : null,
      categories: Array.isArray(inf.categories) ? inf.categories.join(", ") : "",
      location,
      gender: inf.gender || "",
      plan: inf.subscription_plan || "",
      status: app.status || "",
      initiatedBy: app.initiated_by || "",
      proposedRate: app.proposed_rate ?? null,
      brandOfferedRate: app.brand_offered_rate ?? null,
      finalAgreedRate: app.final_agreed_rate ?? null,
      appliedOn: fmtDate(app.created_at),
      reason: ["rejected", "revision_needed"].includes(app.status) ? reasonText(app.rejection_reason) : "",
      submissionLinks: links,
      mediaKit: inf.media_kit_published && handle ? `https://rgossips.com/kit/${handle}` : "",
    };
  });

  await auditLog("campaign_applicants_export", userId, campaignId);

  return { rows, campaignTitle: campaign.title || "" };
}
