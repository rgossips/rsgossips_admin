"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentAdminRole } from "@/lib/require-super-admin";
import { friendlyDbError, logError } from "@/lib/log";
import { auditLog } from "@/lib/rate-limit";
import { identityOf, SEAT_HOLDING_APPLICATION_STATUSES } from "@/lib/sourcing/seats";
import { holdsSeat, stageSpec } from "@/lib/sourcing/stages";
import type { ApplicantExportRow, RosterExportRow } from "./export-columns";

// auth.admin.getUserById is one request per creator; cap the fan-out so a
// campaign with hundreds of applicants doesn't open hundreds of sockets.
const PHONE_LOOKUP_CONCURRENCY = 10;

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

// Bookings store money in paise, applications in rupees. Converting in one
// place beats converting at each use — CLAUDE.md calls mixing the two the
// likeliest bug in anything that touches both tables.
const paiseToRupees = (p: number | null | undefined) =>
  typeof p === "number" && Number.isFinite(p) ? Math.round(p) / 100 : null;

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

// Mirrors lib/barter-fulfilment.ts in words a brand can read in a cell.
// Not imported from it: that module answers "what can an admin do next",
// this answers "where is the parcel", and a spreadsheet wants the latter.
const deliveryStatusOf = (app: { shipping_address?: string | null; shipping_tracking_url?: string | null; product_received?: boolean | null }) => {
  if (app.product_received === true) return "Delivered";
  if (app.product_received === false) return "Not received";
  if (app.shipping_tracking_url) return "Shipped";
  if (app.shipping_address) return "Ready to ship";
  return "";
};

/**
 * The applicant half, shared by both downloads.
 *
 * Extracted rather than copied because the roster export is a superset of
 * this one: a second mapping would mean two answers to "what is this
 * creator's engagement rate" and two places to fix when a column moves.
 * `sno` is left to the caller, since the roster renumbers after merging.
 */
async function buildApplicantRows(
  admin: SupabaseClient,
  campaignId: string,
): Promise<{ error: string } | { rows: Omit<ApplicantExportRow, "sno">[]; keys: (string | null)[] }> {
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

  const rows = (applications || []).map((app) => {
    const inf = app.influencer_profiles || {};
    const handle = inf.instagram_handle || "";
    const phone = phoneMap.get(app.influencer_id);
    const location = inf.location || [inf.city, inf.state].filter(Boolean).join(", ");
    const links = Array.isArray(app.submission_links)
      ? app.submission_links.map((l: { url?: string }) => l?.url).filter(Boolean).join("\n")
      : "";
    return {
      name: inf.full_name || "",
      instagram: handle ? `@${handle}` : "",
      instagramUrl: handle ? `https://instagram.com/${handle}` : "",
      email: inf.email || "",
      phone: phone ? (phone.startsWith("+") ? phone : `+${phone}`) : "",
      followers: typeof inf.followers_count === "number" ? inf.followers_count : null,
      engagementRate: typeof inf.engagement_rate === "number" ? inf.engagement_rate : null,
      categories: Array.isArray(inf.categories) ? inf.categories.join(", ") : "",
      location,
      // The address the creator gave at apply time. This is a home address,
      // which is why the whole export is audit-logged.
      deliveryAddress: app.shipping_address || "",
      deliveryStatus: deliveryStatusOf(app),
      trackingUrl: app.shipping_tracking_url || "",
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

  // The same identity rule countSeats uses, so a creator who both applied
  // and was sourced merges into one roster row.
  const keys = (applications || []).map((app) =>
    identityOf({ influencer_id: app.influencer_id, instagram_username: app.influencer_profiles?.instagram_handle }),
  );

  return { rows, keys };
}

async function gateExport(campaignId: string): Promise<{ error: string } | { userId: string; title: string; admin: SupabaseClient }> {
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

  return { userId, title: campaign.title || "", admin };
}

// Applicant list for the campaign detail page's Excel download. Read-only,
// so viewers may export — but it carries PII (email + phone), so the gate
// is mandatory (server actions bypass the dashboard layout) and every
// export is audit-logged.
export async function getCampaignApplicantsForExport(
  campaignId: string,
): Promise<{ error?: string; rows?: ApplicantExportRow[]; campaignTitle?: string }> {
  const gated = await gateExport(campaignId);
  if ("error" in gated) return { error: gated.error };

  const built = await buildApplicantRows(gated.admin, campaignId);
  if ("error" in built) return { error: built.error };

  const rows: ApplicantExportRow[] = built.rows.map((r, idx) => ({ sno: idx + 1, ...r }));

  await auditLog("campaign_applicants_export", gated.userId, campaignId);

  return { rows, campaignTitle: gated.title };
}

/**
 * Everyone on the campaign, from both intake paths, in one sheet.
 *
 * This is the download under the slots line, and it answers the question
 * that line asks — so it MUST agree with it. Three things make that true:
 * it merges a creator who arrived by both routes into one row using
 * `identityOf`, the same rule countSeats uses; it marks each row's Source;
 * and it carries a "Holds Seat" column, so filtering it to Yes reproduces
 * the number on screen exactly.
 *
 * It deliberately includes creators who do NOT hold a seat — a pending
 * applicant and a creator still being negotiated with are both people on
 * this campaign, and a download that silently dropped them would be a
 * worse answer to "give me everyone" than one that labels them.
 */
export async function getCampaignRosterForExport(
  campaignId: string,
): Promise<{ error?: string; rows?: RosterExportRow[]; campaignTitle?: string }> {
  const gated = await gateExport(campaignId);
  if ("error" in gated) return { error: gated.error };
  const { admin } = gated;

  const built = await buildApplicantRows(admin, campaignId);
  if ("error" in built) return { error: built.error };

  const { data: bookings, error: bookingError } = await admin
    .from("campaign_bookings")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  // A campaign with no outreach tracker yet is not an error — it just has
  // no bookings. Only a real read failure stops the download, because a
  // roster quietly missing its sourced half is worse than no file.
  if (bookingError) return { error: friendlyDbError("export-roster", bookingError, undefined, { campaignId }) };

  // assigned_to is an admin id; the sheet wants a person's name.
  const assigneeIds = [...new Set((bookings || []).map((b) => b.assigned_to).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: admins } = await admin.from("admin_profiles").select("id, full_name, email").in("id", assigneeIds);
    for (const a of admins || []) nameById.set(String(a.id), a.full_name || a.email || "");
  }

  // Start from the applicant rows, then fold each booking in: onto the
  // matching row when the creator already applied, as a new row when they
  // did not.
  const rows: RosterExportRow[] = built.rows.map((r, idx) => ({
    sno: idx + 1,
    source: "Application",
    holdsSeat: "",
    outreachStage: "",
    assignedTo: "",
    quotedFee: null,
    agreedFee: null,
    outreachNotes: "",
    ...r,
  }));
  const rowByKey = new Map<string, RosterExportRow>();
  built.keys.forEach((k, idx) => {
    if (k && !rowByKey.has(k)) rowByKey.set(k, rows[idx]);
  });

  // Seat-holding is decided per route: an application holds a seat by its
  // status, a booking by its stage. A merged row holds one if either does.
  rows.forEach((r) => {
    r.holdsSeat = (SEAT_HOLDING_APPLICATION_STATUSES as readonly string[]).includes(r.status) ? "Yes" : "No";
  });

  for (const b of bookings || []) {
    const handle = String(b.instagram_username || "").trim().replace(/^@/, "");
    const key = identityOf({ influencer_id: b.influencer_id, instagram_username: b.instagram_username });
    const stage = String(b.stage || "");
    const outreach = {
      outreachStage: stageSpec(stage).label,
      assignedTo: b.assigned_to ? nameById.get(String(b.assigned_to)) || "" : "",
      quotedFee: paiseToRupees(b.quoted_fee_paise),
      agreedFee: paiseToRupees(b.agreed_fee_paise),
      // Only the prose half: the notes column also carries import markers
      // and a metadata trailer, which are ours and not the reader's.
      outreachNotes: String(b.notes || "").split("\n---\n")[0].trim(),
    };

    const existing = key ? rowByKey.get(key) : undefined;
    if (existing) {
      Object.assign(existing, outreach);
      existing.source = "Application + Outreach";
      if (holdsSeat(stage)) existing.holdsSeat = "Yes";
      continue;
    }

    rows.push({
      sno: 0, // renumbered below, once the list is complete
      source: "Outreach",
      holdsSeat: holdsSeat(stage) ? "Yes" : "No",
      name: b.creator_name || "",
      instagram: handle ? `@${handle}` : "",
      instagramUrl: handle ? `https://instagram.com/${handle}` : "",
      email: b.email || "",
      phone: b.phone || "",
      followers: typeof b.followers_count === "number" ? b.followers_count : null,
      engagementRate: null,
      // The brand's own wording for what this creator does. Never promoted
      // to a canonical category — those drive campaign matching.
      categories: b.category_raw || "",
      location: "",
      deliveryAddress: b.shipping_address || "",
      deliveryStatus: "",
      trackingUrl: "",
      gender: "",
      plan: "",
      // A sourced creator has no application status. Saying so beats
      // borrowing one, which would read as a decision nobody made.
      status: "",
      initiatedBy: "admin",
      proposedRate: null,
      brandOfferedRate: null,
      finalAgreedRate: null,
      appliedOn: fmtDate(b.created_at),
      reason: "",
      submissionLinks: b.live_url || "",
      mediaKit: "",
      ...outreach,
    });
  }

  rows.forEach((r, idx) => { r.sno = idx + 1; });

  // Same audit event as the applicant export: it is the same PII leaving
  // the building, and splitting the trail would make it easier to miss.
  await auditLog("campaign_applicants_export", gated.userId, campaignId);

  return { rows, campaignTitle: gated.title };
}
