"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { listAllAuthUsers } from "@/lib/phone-search";
import { instagramStatus } from "@/lib/instagram-status";
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-plans";
import { applyInfluencerFilters, type InfluencerFilters } from "@/lib/influencer-filters";
import {
  EXPORT_MAX_ROWS,
  EXPORT_PAGE_SIZE,
  INFLUENCER_EXPORT_COLUMNS,
  type InfluencerExportRow,
} from "./export-columns";

const PAID_PLANS = SUBSCRIPTION_TIERS.map((t) => t.key as string);

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

/**
 * The creator list as rows, honouring the same filters the page is showing.
 *
 * ADMIN ONLY, and audit-logged every time. The applicant export next door
 * is viewer-readable because it is one campaign's applicants; this is the
 * whole creator base with emails, phone numbers and home cities in it,
 * which is a different thing to hand someone. `requireAdmin` rather than
 * `viewerGate` for exactly that reason.
 *
 * Filters come from lib/influencer-filters.ts, the same function the list
 * page calls — so "download what I am looking at" means it, rather than
 * meaning "download something assembled by a second query that was written
 * to look similar".
 *
 * The caller passes which columns it wants. The server still decides what
 * each one CONTAINS; the client only chooses from the catalogue, so a
 * tampered payload can ask for fewer columns but never for a field that is
 * not in INFLUENCER_EXPORT_COLUMNS.
 */
export async function getInfluencersForExport(
  filters: InfluencerFilters,
  columnKeys: string[],
): Promise<{ error?: string; rows?: InfluencerExportRow[]; total?: number; truncated?: boolean }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  // Only keys we published. Anything else is dropped rather than trusted.
  const allowed = new Set(INFLUENCER_EXPORT_COLUMNS.map((c) => c.key));
  const keys = (columnKeys || []).filter((k) => allowed.has(k));
  if (keys.length === 0) return { error: "Pick at least one column." };

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Paged, because PostgREST caps a response at 1000 rows and there is no
  // reason the creator base stays under that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  let truncated = false;
  for (let from = 0; from < EXPORT_MAX_ROWS; from += EXPORT_PAGE_SIZE) {
    let q = admin
      .from("influencer_profiles")
      // select("*") on purpose: optional columns vary by environment and
      // naming one that does not exist fails the WHOLE query — the same
      // reason the applicant export does it.
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1);
    q = applyInfluencerFilters(q, filters, PAID_PLANS, nowIso);

    const { data, error } = await q;
    if (error) {
      logError("influencers.export", error, { from });
      return { error: friendlyDbError("influencers.export", error, "Could not build the export") };
    }
    all.push(...(data || []));
    if (!data || data.length < EXPORT_PAGE_SIZE) break;
    if (all.length >= EXPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
  }

  // Phones live on auth.users and cannot be joined. Only fetched when the
  // column was actually asked for — it is the most expensive thing here
  // and most exports do not need it.
  const phones = new Map<string, string>();
  if (keys.includes("phone")) {
    try {
      const ids = new Set(all.map((r) => String(r.influencer_id)));
      for (const u of await listAllAuthUsers(admin)) {
        if (u.phone && ids.has(u.id)) phones.set(u.id, u.phone);
      }
    } catch (e) {
      // A failed phone read leaves the column blank rather than failing
      // the download someone is waiting on.
      logError("influencers.export", e, { step: "phones" });
    }
  }

  const rows: InfluencerExportRow[] = all.map((r, idx) => {
    const handle = r.instagram_handle || r.username || "";
    const phone = phones.get(String(r.influencer_id));
    const full: InfluencerExportRow = {
      sno: idx + 1,
      fullName: r.full_name || "",
      username: r.username || "",
      instagram: handle ? `@${handle}` : "",
      instagramUrl: handle ? `https://instagram.com/${handle}` : "",
      email: r.email || "",
      phone: phone ? (phone.startsWith("+") ? phone : `+${phone}`) : "",
      followers: typeof r.followers_count === "number" ? r.followers_count : null,
      engagementRate: typeof r.engagement_rate === "number" ? r.engagement_rate : null,
      categories: Array.isArray(r.categories) ? r.categories.join(", ") : "",
      languages: Array.isArray(r.content_languages) ? r.content_languages.join(", ") : "",
      location: r.location || "",
      gender: r.gender || "",
      plan: r.subscription_plan || "",
      billingCycle: r.billing_cycle || "",
      paymentGateway: r.payment_gateway || "",
      status: r.status || "",
      igStatus: instagramStatus(r),
      mediaKit: r.media_kit_published && handle ? `https://rgossips.com/kit/${handle}` : "",
      joinedOn: fmtDate(r.created_at),
    };
    // Narrow to what was asked for, so no unrequested PII crosses the wire.
    const picked: InfluencerExportRow = {};
    for (const k of keys) picked[k] = full[k] ?? "";
    return picked;
  });

  await auditLog(
    "influencers_export",
    actorId,
    `${rows.length} rows; columns: ${keys.join(",")}`,
  );

  return { rows, total: rows.length, truncated };
}
