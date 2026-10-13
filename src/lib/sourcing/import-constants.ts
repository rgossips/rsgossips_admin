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
// Both lists are expressed in the NINE-STAGE pipeline (rgossips_web
// migration 085). They used to name the old 18-stage ladder, which still
// compiled after the replacement — they are plain string arrays — but every
// value was one the new CHECK rejects, so an import would have failed with
// a hard 400 on the first row. Nothing in TypeScript catches that; it has
// to be kept in step by hand with lib/sourcing/stages.ts.
//
// IMPORTABLE_STAGES — a LIVE campaign being sourced now. Capped at
// `quote_review`: a cell reading "Reimbursed" is someone's memory of a
// payment, and importing it would make the portal assert money moved with
// no record of who moved it. The later stages get walked in the tracker,
// where each move is logged against an admin.
export const IMPORTABLE_STAGES = ["proposed", "shortlisted", "outreach", "quote_review", "dropped"] as const;

// HISTORICAL_STAGES — a FINISHED campaign being recorded after the fact. A
// row reading "Live" with a link to prove it is a fact, not optimism, so
// the pipeline opens up to the end.
//
// `product` is in here where the old list excluded its equivalents: in the
// new pipeline it means "the team is handling the product", not "a payout
// has been queued" — nothing is queued by entering a stage any more, since
// settlement is recorded explicitly at `closed` with a mode and an amount.
export const HISTORICAL_STAGES = [
  "proposed",
  "shortlisted",
  "outreach",
  "quote_review",
  "product",
  "content",
  "content_review",
  "payout",
  "closed",
  "dropped",
] as const;

export type HistoricalStage = (typeof HISTORICAL_STAGES)[number];

export function isHistoricalStage(value: unknown): value is HistoricalStage {
  return typeof value === "string" && (HISTORICAL_STAGES as readonly string[]).includes(value);
}
