// Bulk-import tuning. Plain module, NOT "use server": every export from a
// "use server" file becomes a callable client ref at import time, so a
// constant declared beside the action would be replaced by a function —
// the same split as enrich-constants.ts.

// Rows per server call. The client slices the parsed workbook and calls
// once per chunk, so a 300-row sheet stays well inside the Netlify function
// timeout no matter how many creators are new (each of those is an
// invitation insert on top of the booking).
export const IMPORT_CHUNK_SIZE = 100;

// Hard ceiling the server enforces, independent of what the client sends.
export const MAX_ROWS_PER_CALL = 150;

// Upper bound on one workbook. The xlsx parse is synchronous on the main
// thread, so a huge file freezes the tab before chunking can help.
export const MAX_IMPORT_ROWS = 2000;

// Rows per call for the historical backfill. Smaller than IMPORT_CHUNK_SIZE
// because each row can do more work — an invitation insert, a booking
// insert or update, two timeline events and an application reconcile — and
// because the worst case is the batch insert failing and falling back to N
// sequential single-row inserts.
export const BACKFILL_CHUNK_SIZE = 50;

// ── What stage a sheet is allowed to assert ──────────────────────────────
//
// Two allowlists, because "importing a sheet" means two different things.
//
// IMPORTABLE_STAGES — a LIVE campaign being sourced now. Capped at
// `confirmed`: a cell reading "Reimbursed" is someone's memory of a
// payment, and importing it would make the portal assert a payout with no
// record of who made it. The later stages get walked in the portal, where
// each one is logged and the payout legs are queued by the transition.
export const IMPORTABLE_STAGES = ["shortlisted", "price_agreed", "confirmed", "declined"] as const;

// HISTORICAL_STAGES — a FINISHED campaign being recorded after the fact. A
// row reading "Live" with a link to prove it is a fact, not optimism, so
// the ladder opens up.
//
// Absent from BOTH lists, and that is the point:
//
//   product_purchased / product_approved / reimbursed
//       product_approved is one of the two entries in PAYOUT_ON_ENTER, so
//       landing there queues a reimbursement for money settled offline
//       months ago.
//   product_shipped / product_delivered
//       would fabricate a dispatch record — a tracking number nobody has.
//
// So no import of either kind can write a money stage, rather than merely
// trying not to.
export const HISTORICAL_STAGES = [
  "contacted",
  "confirmed",
  "script_shared",
  "draft_received",
  "revision_needed",
  "admin_approved",
  "brand_approved",
  "live",
  "fee_paid",
  "declined",
] as const;

export type HistoricalStage = (typeof HISTORICAL_STAGES)[number];

export function isHistoricalStage(value: unknown): value is HistoricalStage {
  return typeof value === "string" && (HISTORICAL_STAGES as readonly string[]).includes(value);
}
