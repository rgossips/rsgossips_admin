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

/**
 * True once the whole of the stored day has passed.
 *
 * The calendar date is read out of the STRING, not via `new Date()`. These
 * columns hold a zone-less midnight ("2026-10-24T00:00:00"), so `new Date()`
 * resolves them in the RUNTIME's zone — correct on Netlify, which is UTC,
 * and 5.5 hours out when the same code runs on an IST machine. Parsing the
 * parts makes the answer identical everywhere, which is what rgossips_web's
 * `_shared/campaign-dates.ts` does and why. Keep the two in step.
 *
 * The day itself still counts: a campaign whose end date is today has not
 * ended. Cutting that short is the bug the upstream module exists to kill.
 */
export function dayHasPassed(value: string | null | undefined, now: number = Date.now()): boolean {
  if (!value) return false;
  const ymd = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endOfDay = ymd
    ? Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 23, 59, 59, 999)
    : (() => {
        const d = new Date(value);
        return Number.isNaN(d.getTime())
          ? NaN
          : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
      })();
  if (Number.isNaN(endOfDay)) return false;
  return now > endOfDay;
}
