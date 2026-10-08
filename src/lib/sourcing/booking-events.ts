// One writer for a booking's timeline.
//
// Plain module, not "use server": it takes the Supabase client as an
// argument, so it is a helper rather than an action and can be shared by
// the sourcing actions and the historical import without either of them
// keeping its own copy. Two copies meant two chances for the timeline to
// disagree with what actually happened.
//
// Best-effort by contract. The timeline is for humans to read; losing a
// line of it must never fail the state change it describes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";

export type BookingEvent = {
  kind: "stage_change" | "outreach" | "note" | "receipt" | "payout";
  from_stage?: string | null;
  to_stage?: string | null;
  channel?: string | null;
  template?: string | null;
  note?: string | null;
  actor_id?: string | null;
};

export async function logBookingEvent(
  admin: SupabaseClient,
  bookingId: string,
  row: BookingEvent,
): Promise<void> {
  try {
    await admin.from("campaign_booking_events").insert({ booking_id: bookingId, ...row });
  } catch (e) {
    logError("sourcing.event", e, { bookingId, kind: row.kind });
  }
}

/** Several at once, for an import. Still best-effort, still never throws. */
export async function logBookingEvents(
  admin: SupabaseClient,
  rows: ({ booking_id: string } & BookingEvent)[],
): Promise<void> {
  if (!rows.length) return;
  try {
    await admin.from("campaign_booking_events").insert(rows);
  } catch (e) {
    logError("sourcing.events", e, { count: rows.length });
  }
}
