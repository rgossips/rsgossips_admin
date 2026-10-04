// How many of a campaign's seats are taken, across BOTH intake paths.
//
// A campaign's `max_influencers` is what the brand asked for. Those seats
// fill from two directions at once: creators who apply through the portal,
// and creators an admin sources by hand. Counting one and not the other is
// how a campaign ends up double-booked.
//
// This module is the single owner of that arithmetic. The campaign header,
// the sourcing tab and anything else that wants "62 of 100" must call it
// rather than counting rows themselves.

import { holdsSeat } from "./stages";

// Application statuses that occupy a seat.
//
// `live_submitted` and `payment` were MISSING from the campaign header's
// original count — an existing undercount this fixes. A creator who has
// posted and is waiting to be paid is obviously still on the campaign.
export const SEAT_HOLDING_APPLICATION_STATUSES = [
  "approved",
  "submitted",
  "revision_needed",
  "accepted",
  "live_submitted",
  "payment",
  "completed",
] as const;

export type SeatApplication = {
  influencer_id?: string | null;
  status?: string | null;
};

export type SeatBooking = {
  influencer_id?: string | null;
  instagram_username?: string | null;
  stage?: string | null;
};

export type SeatCount = {
  /** Seats the brand asked for. Null when the campaign never said. */
  capacity: number | null;
  /** Taken across both paths, deduplicated. */
  taken: number;
  fromApplications: number;
  fromBookings: number;
  /** Counted once because the same creator arrived by both routes. */
  overlap: number;
  remaining: number | null;
  /** More creators than seats. A warning, never a block — people drop out. */
  over: boolean;
};

// A creator is the same creator whether they came through the portal or a
// DM. Prefer their profile id; fall back to the lowercased handle, which is
// all a sourced creator has until they sign up.
function identityOf(x: { influencer_id?: string | null; instagram_username?: string | null }): string | null {
  if (x.influencer_id) return `id:${x.influencer_id}`;
  const handle = String(x.instagram_username || "").trim().toLowerCase().replace(/^@/, "");
  return handle ? `ig:${handle}` : null;
}

export function countSeats(
  capacity: number | null | undefined,
  applications: SeatApplication[],
  bookings: SeatBooking[],
): SeatCount {
  const appIds = new Set<string>();
  let appAnonymous = 0;
  for (const a of applications) {
    if (!a.status || !(SEAT_HOLDING_APPLICATION_STATUSES as readonly string[]).includes(a.status)) continue;
    const key = identityOf(a);
    // An application always has an influencer_id, but if one is somehow
    // missing it still occupies a seat — count it rather than lose it.
    if (key) appIds.add(key);
    else appAnonymous++;
  }

  const bookingIds = new Set<string>();
  let bookingAnonymous = 0;
  for (const b of bookings) {
    if (!holdsSeat(b.stage || "")) continue;
    const key = identityOf(b);
    if (key) bookingIds.add(key);
    else bookingAnonymous++;
  }

  let overlap = 0;
  for (const key of bookingIds) if (appIds.has(key)) overlap++;

  const fromApplications = appIds.size + appAnonymous;
  const fromBookings = bookingIds.size + bookingAnonymous;
  const taken = fromApplications + fromBookings - overlap;
  const cap = typeof capacity === "number" && capacity > 0 ? capacity : null;

  return {
    capacity: cap,
    taken,
    fromApplications,
    fromBookings,
    overlap,
    remaining: cap === null ? null : Math.max(cap - taken, 0),
    over: cap !== null && taken > cap,
  };
}

// "62 of 100 · 18 applied · 44 sourced · 38 left"
export function describeSeats(s: SeatCount): string {
  const parts = [
    s.capacity === null ? `${s.taken} booked` : `${s.taken} of ${s.capacity}`,
    `${s.fromApplications} applied`,
    `${s.fromBookings} sourced`,
  ];
  if (s.overlap > 0) parts.push(`${s.overlap} counted once`);
  if (s.remaining !== null) parts.push(s.over ? "over capacity" : `${s.remaining} left`);
  return parts.join(" · ");
}
