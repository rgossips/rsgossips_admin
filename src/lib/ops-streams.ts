// The admin "awaiting action" streams, and the filters that define them.
//
// Plain module, NOT "use server": these are values, and every export from a
// "use server" file becomes a callable client ref at import time.
//
// Why this exists: the bell (getAwaitingActionFeed) and the desktop widget
// (/api/widget/stats) both answer "how many things need an admin?", and they
// had each written the queries out separately. The bell grew from four
// streams to eight — payouts due, stalled barter deliveries, support
// callbacks and status changes on our own campaigns were all added later —
// and the widget was never taught about any of them. The portal showed 9
// notifications while the widget showed 0, because the four it knew about
// were all empty and the 9 lived entirely in the four it did not.
//
// So the predicate for each stream lives here exactly once. The bell applies
// it with its own select/order/limit because it needs rows to render; the
// widget applies it to a head count because it needs only a number. Adding
// a stream means adding it here, and both surfaces get it.

import type { SupabaseClient } from "@supabase/supabase-js";

export type OpsStreamKey =
  | "quotes"
  | "deliverables"
  | "campaignReviews"
  | "brandVerifications"
  | "payoutsDue"
  | "barterDeliveries"
  | "callbacks"
  | "adminCampaignUpdates";

// How far back a status change still counts as news.
export const ADMIN_UPDATE_WINDOW_DAYS = 3;

export type OpsStream = {
  key: OpsStreamKey;
  table: string;
  /** A column that exists on the table, for `select(col, { head: true })`. */
  countColumn: string;
  /**
   * The stream's defining filters. Both callers pass their own query builder
   * through this, so the bell and the widget can never disagree about what
   * the stream means.
   *
   * `now` is passed in rather than read from the clock inside, so every
   * stream in one pass measures against the same instant.
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  filter: (q: any, now: string) => any;
};

export const OPS_STREAMS: OpsStream[] = [
  {
    key: "quotes",
    table: "service_orders",
    countColumn: "id",
    filter: (q) => q.in("status", ["pending_quote", "counter_offered", "revision_requested"]),
  },
  {
    key: "deliverables",
    table: "campaign_applications",
    countColumn: "id",
    filter: (q) => q.eq("status", "submitted"),
  },
  {
    key: "campaignReviews",
    table: "campaigns",
    countColumn: "campaign_id",
    filter: (q) => q.eq("status", "under_review"),
  },
  {
    key: "brandVerifications",
    table: "brand_profiles",
    countColumn: "brand_id",
    filter: (q) => q.eq("verification_status", "pending"),
  },
  {
    // Payouts are manual (RazorpayX was removed): a scheduled payout whose
    // release time has passed is money an admin owes a creator today.
    key: "payoutsDue",
    table: "campaign_applications",
    countColumn: "id",
    filter: (q, now) => q.eq("payout_status", "scheduled").lte("payout_release_at", now),
  },
  {
    // Barter deliveries that stalled: dispatched and overdue with no word, or
    // explicitly reported as not arrived. Filtered in SQL so the settled ones
    // are never loaded.
    key: "barterDeliveries",
    table: "campaign_applications",
    countColumn: "id",
    filter: (q, now) =>
      q
        .not("shipping_tracking_url", "is", null)
        .or(`and(product_received.is.null,shipping_expected_at.lt.${now}),product_received.is.false`),
  },
  {
    key: "callbacks",
    table: "support_callbacks",
    countColumn: "id",
    filter: (q) => q.eq("status", "open"),
  },
  {
    // Status changes on campaigns WE created. brand_id IS NULL means there is
    // no registered brand behind the campaign, which is exactly the case
    // where nobody else gets told.
    key: "adminCampaignUpdates",
    table: "application_status_history",
    countColumn: "id",
    filter: (q, now) =>
      q
        .is("campaign_applications.campaigns.brand_id", null)
        .gte("created_at", windowStart(now, ADMIN_UPDATE_WINDOW_DAYS)),
  },
];

// The embed the adminCampaignUpdates stream needs in its select for its
// filter to resolve. An inner join, so only admin-owned campaigns come back.
export const ADMIN_UPDATE_EMBED = "campaign_applications!inner(campaign_id, campaigns!inner(title, brand_id))";

export function windowStart(now: string, days: number): string {
  return new Date(new Date(now).getTime() - days * 86_400_000).toISOString();
}

const BY_KEY = new Map(OPS_STREAMS.map((s) => [s.key, s]));

// Apply one stream's defining filters to a query the caller has already
// given its own select. For the bell, which needs rows rather than a count:
//
//   applyStream("payoutsDue", admin.from("campaign_applications").select(…), now)
//     .order("payout_release_at", { ascending: true }).limit(10)
//
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function applyStream(key: OpsStreamKey, query: any, now: string): any {
  const stream = BY_KEY.get(key);
  if (!stream) throw new Error(`Unknown ops stream: ${key}`);
  return stream.filter(query, now);
}

export type OpsStreamCounts = Record<OpsStreamKey, number | null>;

// Head-count every stream in one pass. A count is `null` when the query
// failed or the table is not live — never a fake 0, because "nothing needs
// doing" and "we could not look" are different answers and only one of them
// should let an admin stop checking.
export async function countOpsStreams(
  admin: SupabaseClient,
  now = new Date().toISOString(),
): Promise<OpsStreamCounts> {
  const results = await Promise.all(
    OPS_STREAMS.map(async (s) => {
      const select = s.key === "adminCampaignUpdates" ? `${s.countColumn}, ${ADMIN_UPDATE_EMBED}` : s.countColumn;
      const { count, error } = await s.filter(
        admin.from(s.table).select(select, { count: "exact", head: true }),
        now,
      );
      return [s.key, error || count === null ? null : count] as const;
    }),
  );
  return Object.fromEntries(results) as OpsStreamCounts;
}

// Sum of the streams we could actually read. Null only when every single one
// failed, so one missing table degrades the total rather than erasing it.
export function totalOpsCount(counts: OpsStreamCounts): number | null {
  const known = Object.values(counts).filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
