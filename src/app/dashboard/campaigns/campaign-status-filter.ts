// The campaign list's status filter: its vocabulary, its default, and the one
// place a filter value becomes a query predicate.
//
// Plain module, NOT "use server" — values and pure functions.
//
// ONE OWNER on purpose. The tab row (campaign-filters.tsx) and the page query
// (page.tsx) must agree about what each tab selects, and the interesting
// values here are DERIVED rather than column equality: `apps_closed` is not a
// status in the database at all, and `live` and `active` differ only by
// whether the application window has lapsed. Two copies of that is how a tab
// comes to promise something the query does not do — the same failure the
// Approve/Reject buttons hit when their trigger and their panel kept separate
// status lists.

import { applicationsClosedBefore } from "@/lib/campaign-deadline";

/**
 * The default view, and `status = 'active'` in the database with no further
 * condition: every campaign that has not been finished, paused or parked.
 *
 * It needs its own value because `active` already means something NARROWER
 * here — the tabs offer "still accepting applications" and "applications
 * closed" as a pair that partitions the active campaigns, so `active`
 * deliberately excludes the lapsed ones. Measured when this landed: 79
 * campaigns, 35 active, and 30 of those 35 had a lapsed deadline. Defaulting
 * to `active` would therefore have opened the page on 5 rows and hidden 30
 * live campaigns, which is a worse answer than loading all 79.
 */
export const DEFAULT_STATUS_FILTER = "live";

/** Every status, no predicate. Distinct from an absent param, which is the default. */
export const ALL_STATUS_FILTER = "all";

/**
 * Tab order, and the allowlist. `key` is the i18n key under
 * `DashboardCampaignsCampaignFilters.status`; each also has a `.hint` used as
 * the tab's `title`, because the three active-ish tabs need short labels to
 * fit in one row and short labels cannot say what they mean.
 */
export const CAMPAIGN_STATUS_FILTERS = [
  { key: "live", value: DEFAULT_STATUS_FILTER },
  { key: "open", value: "active" },
  { key: "appsClosed", value: "apps_closed" },
  { key: "draft", value: "draft" },
  { key: "comingSoon", value: "coming_soon" },
  { key: "underReview", value: "under_review" },
  { key: "rejected", value: "rejected" },
  { key: "paused", value: "paused" },
  { key: "completed", value: "completed" },
  { key: "all", value: ALL_STATUS_FILTER },
] as const;

/** The values that are NOT a `campaigns.status` and so never reach `.eq()`. */
const DERIVED = new Set<string>([DEFAULT_STATUS_FILTER, ALL_STATUS_FILTER, "apps_closed", "active"]);

const ALLOWED = new Set<string>(CAMPAIGN_STATUS_FILTERS.map((o) => o.value));

/**
 * Resolve `?status=` against the allowlist.
 *
 * An absent, empty or unrecognised value becomes the default rather than
 * reaching a query — the same rule the sort keys follow, and the reason
 * `applyStatusFilter` can pass its argument to `.eq()` without sanitising it.
 * Note this re-points one old shape of link: `?status=` (empty, which used to
 * mean "All") now opens on Active. `?status=all` is the way to ask for all.
 */
export function resolveStatusFilter(raw: string | string[] | undefined | null): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const s = String(v ?? "").trim();
  return ALLOWED.has(s) ? s : DEFAULT_STATUS_FILTER;
}

/** True when this filter is the default, i.e. not something the admin chose. */
export function isDefaultStatus(value: string): boolean {
  return value === DEFAULT_STATUS_FILTER;
}

/**
 * Narrow a campaigns query to one status filter.
 *
 * `value` must have come from `resolveStatusFilter`, which is what makes the
 * final `.eq()` safe: anything not on the allowlist has already become the
 * default, and every allowlisted value that is not a real column value is
 * handled above it.
 */
export function applyStatusFilter<T>(query: T, value: string, now?: number): T {
  if (value === ALL_STATUS_FILTER) return query;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const q = query as any;
  if (value === DEFAULT_STATUS_FILTER) return q.eq("status", "active") as T;

  // Both derived branches share ONE cutoff with the list badge — see
  // lib/campaign-deadline.ts, which exists because they disagreed, and
  // disagreed with the creator app.
  const closedBefore = applicationsClosedBefore(now);
  if (value === "apps_closed") {
    // Not a database status: active campaigns whose application window has
    // lapsed. `.lt` on a timestamp excludes NULL deadlines, which is right —
    // no deadline means the window never closes.
    return q.eq("status", "active").lt("application_deadline", closedBefore) as T;
  }
  if (value === "active") {
    // ...and because `apps_closed` is offered as a SIBLING of this tab, this
    // one has to exclude it. Otherwise picking it listed the closed ones too
    // (they are `status = 'active'` in the database) and the rows came back
    // wearing an "Applications Closed" badge.
    return q
      .eq("status", "active")
      .or(`application_deadline.is.null,application_deadline.gte.${closedBefore}`) as T;
  }
  // A real column value, guaranteed by the allowlist.
  if (DERIVED.has(value)) return query;
  return q.eq("status", value) as T;
}
