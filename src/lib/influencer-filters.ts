// The influencer list's filters, in one place.
//
// WHY THIS IS SHARED. The list page and the Excel export must select the
// same creators. Forty-five lines of query building copied into an export
// action would be a second definition of "who matches", and the first
// symptom would be a spreadsheet quietly disagreeing with the page it was
// downloaded from — the kind of drift seats.ts, gender-match and
// application-match all exist to prevent.
//
// Validation stays with the CALLER. Every value here reaches a hand-built
// PostgREST filter on the RLS-bypassing service client, so `city`,
// `language`, `gender`, `plan`, `er` and `igstatus` must already have been
// checked against their allowlists, and `search` must already have gone
// through sanitizeSearchTerm(). This module trusts what it is given and
// says so rather than re-validating badly.

import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";

export type InfluencerFilters = {
  /** Already sanitized. Empty string means no search. */
  searchTerm?: string;
  /** Auth ids resolved from a digits-only search, OR-ed into the name match. */
  phoneInfluencerIds?: string[];
  status?: string;
  /** "min-max", either side optional. */
  followers?: string;
  /** Comma-separated; matched with `contains`. */
  category?: string;
  gender?: string;
  /** A tier key, or "paid" for any paid tier. */
  plan?: string;
  /** "yes" | "no". */
  mediakit?: string;
  /** "min-max" on engagement_rate, as a percentage. */
  er?: string;
  city?: string;
  language?: string;
  igstatus?: string;
};

/** Tier keys that count as "paid" when `plan === "paid"`. */
export type PaidPlans = readonly string[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = PostgrestFilterBuilder<any, any, any, any, any>;

/**
 * Apply the list's filters to a query over `influencer_profiles`.
 *
 * Returns the builder so it can be chained. Order matters only for the
 * igstatus branch, which stacks several predicates — separate `.or()` calls
 * are AND-ed by PostgREST, which is what makes that branch work at all.
 */
export function applyInfluencerFilters<T extends Q>(
  query: T,
  f: InfluencerFilters,
  paidPlans: PaidPlans,
  nowIso: string,
): T {
  let q = query;

  if (f.searchTerm) {
    const clauses = [`full_name.ilike.%${f.searchTerm}%`, `username.ilike.%${f.searchTerm}%`];
    if (f.phoneInfluencerIds && f.phoneInfluencerIds.length > 0) {
      clauses.push(`influencer_id.in.(${f.phoneInfluencerIds.join(",")})`);
    }
    q = q.or(clauses.join(",")) as T;
  }
  if (f.status) q = q.eq("status", f.status) as T;
  if (f.followers) {
    const [min, max] = f.followers.split("-");
    if (min) q = q.gte("followers_count", parseInt(min)) as T;
    if (max) q = q.lte("followers_count", parseInt(max)) as T;
  }
  if (f.category) {
    const cats = f.category.split(",").filter(Boolean);
    if (cats.length > 0) q = q.contains("categories", cats) as T;
  }
  if (f.gender) q = q.eq("gender", f.gender) as T;
  if (f.plan) {
    q = (f.plan === "paid"
      ? q.in("subscription_plan", paidPlans as string[])
      : q.eq("subscription_plan", f.plan)) as T;
  }
  if (f.mediakit) q = q.eq("media_kit_published", f.mediakit === "yes") as T;
  // Engagement bands. `engagement_rate` is a percentage, populated on every
  // row, and the floors match how briefs are written ("3%+ creators").
  if (f.er) {
    const [min, max] = f.er.split("-");
    if (min) q = q.gte("engagement_rate", Number(min)) as T;
    if (max) q = q.lte("engagement_rate", Number(max)) as T;
  }
  // `location` is a comma-joined scalar, not an array (see CLAUDE.md,
  // "Cities / location"), so this is a substring match — the same thing the
  // consumer app's matcher does. Only 14% of profiles have one set, so it
  // narrows hard by design.
  if (f.city) q = q.ilike("location", `%${f.city}%`) as T;
  if (f.language) q = q.contains("content_languages", [f.language]) as T;
  // Same rules as instagramStatus(), expressed as filters so paging and the
  // count stay right. Separate .or() params are AND-ed by PostgREST.
  if (f.igstatus) {
    const now = `"${nowIso}"`;
    const tokenLive = `instagram_token_expires_at.is.null,instagram_token_expires_at.gte.${now}`;
    if (f.igstatus === "not_connected") {
      q = q.is("instagram_access_token", null) as T;
    } else if (f.igstatus === "reconnect") {
      q = q
        .not("instagram_access_token", "is", null)
        .or(`instagram_token_invalid_at.not.is.null,instagram_token_expires_at.lt.${now}`) as T;
    } else if (f.igstatus === "insights_denied" || f.igstatus === "authorized") {
      q = q
        .not("instagram_access_token", "is", null)
        .is("instagram_token_invalid_at", null)
        .or(tokenLive) as T;
      q = (f.igstatus === "insights_denied"
        ? q.not("instagram_insights_denied_at", "is", null)
        : q.is("instagram_insights_denied_at", null)) as T;
    }
  }

  return q;
}

/** A human summary of what is selected, for the export dialog. */
export function describeFilters(f: InfluencerFilters): string[] {
  const out: string[] = [];
  if (f.searchTerm) out.push(`search “${f.searchTerm}”`);
  if (f.status) out.push(`status ${f.status}`);
  if (f.followers) out.push(`followers ${f.followers.replace("-", "–")}`);
  if (f.category) out.push(`categories ${f.category.split(",").filter(Boolean).join(", ")}`);
  if (f.gender) out.push(`gender ${f.gender}`);
  if (f.plan) out.push(`plan ${f.plan}`);
  if (f.mediakit) out.push(`media kit ${f.mediakit}`);
  if (f.er) out.push(`engagement ${f.er.replace("-", "–")}%`);
  if (f.city) out.push(`city ${f.city}`);
  if (f.language) out.push(`language ${f.language}`);
  if (f.igstatus) out.push(`Instagram ${f.igstatus.replace(/_/g, " ")}`);
  return out;
}
