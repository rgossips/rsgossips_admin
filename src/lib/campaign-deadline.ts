// When do a campaign's applications close?
//
// One owner, because three places ask: the campaigns-list badge, the list's
// status filter, and anything that counts open campaigns. They disagreed, and
// worse, they disagreed with the creator app.
//
// `application_deadline` is stored as a zone-less midnight ("2026-09-30T00:00:00"),
// i.e. a DATE pretending to be a timestamp. Read literally, a deadline of today
// expired at 05:30 IST this morning — so the admin portal badged a campaign
// "Applications Closed" while creators could still apply to it all day.
//
// The creator app (list-campaigns' `countdown`) uses
// `Math.ceil((deadline - now) / 1 day)` and only calls it expired below zero,
// which for a midnight value means the deadline day itself still counts as
// open. This mirrors that exactly: the window closes 24 hours after the stored
// midnight, i.e. at the end of the deadline's own day.
//
// Keep it in step with list-campaigns/index.ts in rgossips_web. If that
// countdown changes, this changes.

const ONE_DAY_MS = 86_400_000;

// A deadline at or before this instant has lapsed.
export function applicationsClosedBefore(now: number = Date.now()): string {
  return new Date(now - ONE_DAY_MS).toISOString();
}

// The badge's rule. Only an `active` campaign can be "applications closed" —
// a draft or completed one says what it is. A NULL deadline never closes.
export function applicationsClosed(status: string | null, deadline: string | null, now: number = Date.now()): boolean {
  if (status !== "active") return false;
  if (!deadline) return false;
  return new Date(deadline).getTime() < now - ONE_DAY_MS;
}
