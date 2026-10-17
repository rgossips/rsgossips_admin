// Which notifications matter more than the others.
//
// Everything in the feed is technically "awaiting action" — that is what
// getAwaitingActionFeed selects. So a useful priority cannot just restate
// that; it has to separate work from news, and then separate the work that
// costs something to delay from the work that does not.
//
// One owner, because the tiles on the notifications page and anything that
// later wants to colour a row or drive a digest must agree about what
// "important" means.

/** The notification types the feed can produce. Mirrors Notification.type. */
export type NotificationType =
  | "quote_request"
  | "submission"
  | "application"
  | "campaign_review"
  | "brand_verification"
  | "payout_due"
  | "delivery_stalled"
  | "callback"
  | "admin_campaign_update";

/**
 * News, not work.
 *
 * `admin_campaign_update` is a status change on a campaign we created. It
 * exists because nobody else is told — there is no brand behind those
 * campaigns to notify — but reading it is the whole job. Leaving it in
 * "needs action" makes that number untrustworthy, and a number an admin
 * learns to discount is worse than no number.
 */
export const INFORMATIONAL: ReadonlySet<string> = new Set(["admin_campaign_update"]);

/**
 * Someone outside the building is blocked or out of pocket.
 *
 *   payout_due        — a creator is owed money whose release date passed.
 *   callback          — a person asked to be phoned back and is waiting.
 *   campaign_review   — a brand cannot publish until we approve it.
 *   brand_verification— a brand cannot publish at all until we verify them.
 *
 * Deliberately NOT here: quote requests and submitted deliverables, which
 * are ordinary queue work, and stalled deliveries, which are already late
 * by definition and would swamp the tile without distinguishing anything.
 */
export const HIGH_IMPORTANCE: ReadonlySet<string> = new Set([
  "payout_due",
  "callback",
  "campaign_review",
  "brand_verification",
]);

/**
 * Age alone can promote an item.
 *
 * A quote request is routine on day one and a problem on day four: the
 * person asking has been ignored either way, and the thing that changed is
 * only how long. Three days is the threshold because it survives a weekend
 * without flagging everything that arrived on Friday.
 */
export const STALE_DAYS = 3;

const DAY_MS = 86_400_000;

/**
 * Timestamps arrive in two shapes. Some tables return them WITHOUT a
 * timezone ("2026-07-04T06:26:54") while others include "+00:00"; per the
 * ES spec a timezone-less ISO string is parsed as the VIEWER's local time,
 * but every value in this stack is UTC. Same normalisation the bell does —
 * without it an IST admin sees everything 5.5 hours younger than it is.
 */
export function parseFeedTime(iso: string): number {
  if (!iso) return NaN;
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
  return new Date(hasTz ? iso : iso.replace(" ", "T") + "Z").getTime();
}

export function isStale(iso: string, now: number = Date.now()): boolean {
  const ms = parseFeedTime(iso);
  if (!Number.isFinite(ms)) return false;
  return now - ms >= STALE_DAYS * DAY_MS;
}

/** Work an admin has to do, as opposed to something to read. */
export function needsAction(n: { type: string }): boolean {
  return !INFORMATIONAL.has(n.type);
}

/**
 * Costly to leave. Either the type is inherently blocking somebody, or it
 * has sat long enough that it has become so.
 */
export function isHighImportance(
  n: { type: string; time: string },
  now: number = Date.now(),
): boolean {
  if (!needsAction(n)) return false;
  return HIGH_IMPORTANCE.has(n.type) || isStale(n.time, now);
}
