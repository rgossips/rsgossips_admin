// The Vega × Adinfinity backfill — this one-off's sheet vocabulary.
//
// Seven campaigns were run on spreadsheets before the sourcing tab existed.
// The creator lists, how far each one got, their deliverable links and what
// they were paid live in two workbooks. This module owns the translation
// from those columns into the portal's own vocabulary, and nothing else:
// the writing is done by importSourcingRows, which every other import path
// already uses.
//
// Plain module, NOT "use server" — the parse runs in the browser and the
// derivation is shared by both sides, so a "use server" file here would
// turn every constant into a callable client ref.

import { parseMoney, type SourcingImportRow } from "@/lib/sourcing/import-parse";
import type { HistoricalStage } from "@/lib/sourcing/import-constants";
import type { FulfilmentMode } from "@/lib/sourcing/stages";

// Stamped into each booking's notes trailer. It is what makes a re-run safe:
// a booking carrying this key was written by this import and may be updated
// from the sheet, while one WITHOUT it was built by hand in the portal and
// must never be overwritten.
export const IMPORT_KEY = "vega-adinfinity";

// Sheet -> campaign. Hardcoded rather than chosen in a dropdown because
// this is a backfill of seven named campaigns that already exist; a mapping
// UI would be seven chances to put a creator on the wrong brief.
export const VEGA_SHEET_CAMPAIGNS: Record<string, string> = {
  "VHSCC-01(Barter)": "19a8c26d-2ec0-4dbc-ad02-0524520ba668",
  "VHSB-07(Barter)": "8a221274-c22e-4b80-ab99-d79d89dde982",
  "4-in-1 (Barter)": "7f708086-8a11-4482-b67c-0b22a8dca9ac",
  "VHTH 32 (Paid)": "c0c3c4ad-a2c9-432c-a7c6-638f26bed517",
  "4-in-1 (Paid)": "519966fe-b4f4-4050-a81b-ca28f5a45f60",
  "VHSD-04(Paid)": "1f4e1bae-89b7-4483-acd4-a888554a93a4",
  "4-in-1 (above 10k Charges)": "76bf87c8-0943-4ce9-ae94-57785a0d262f",
};

// The stage allowlist lives in import-constants.ts beside IMPORTABLE_STAGES,
// so the two can be read against each other — the money stages are missing
// from both, and that is easier to see when they sit together.
export type { HistoricalStage };

// ── Progress ─────────────────────────────────────────────────────────────
//
// Five values across 213 rows, plus blank on 56 of them. An unrecognised
// value returns null and the row is WARNED, never guessed: the same
// discipline as the suspect-email-domain rule, and for the same reason —
// a guess here asserts a payout state nobody wrote down.

export type VegaProgress =
  | "live"
  | "draft_approval"
  | "rework"
  | "in_progress"
  | "product_not_received"
  | "blank";

export function normalizeProgress(raw: unknown): VegaProgress | null {
  const s = String(raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return "blank";
  if (s === "live") return "live";
  if (s === "video on approval") return "draft_approval";
  if (s === "video rework") return "rework";
  if (s === "video on progress") return "in_progress";
  if (s === "product not received") return "product_not_received";
  return null;
}

export const PROGRESS_LABEL: Record<VegaProgress, string> = {
  live: "Live",
  draft_approval: "Video on Approval",
  rework: "Video Rework",
  in_progress: "Video on Progress",
  product_not_received: "Product Not Received",
  blank: "(blank)",
};

// ── Commercial ───────────────────────────────────────────────────────────
//
// 168 rows read "Barter"; the rest are rupees. Note this is the QUOTED
// figure — the payment workbook's "Negotiated Pricing" is what was actually
// agreed, and the two differ a lot (10k quoted against 1.5k-9k agreed).
// That column can itself read "Barter", so it goes through the same parse
// and a non-numeric value lands as null rather than zero.
export function parseCommercial(raw: unknown): { isBarter: boolean; rupees: number | null } {
  const s = String(raw ?? "").trim();
  if (!s) return { isBarter: true, rupees: null };
  if (/^barter$/i.test(s)) return { isBarter: true, rupees: null };
  const rupees = parseMoney(s);
  // A value we cannot read is not evidence of a fee.
  return { isBarter: rupees === null, rupees };
}

// ── The mapping table ────────────────────────────────────────────────────
//
// Progress -> booking stage AND application status, in one function so the
// two vocabularies cannot drift.
//
//   Progress              fee / payment            stage           application
//   Live                  barter                   live            completed
//   Live                  paid, Done/Cleared       fee_paid        completed
//   Live                  paid, not paid           live            live_submitted
//   Video on Approval     any                      draft_received  submitted
//   Video Rework          any                      revision_needed revision_needed
//   Video on Progress     any                      script_shared   approved
//   Product Not Received  any                      confirmed       approved
//   blank                 any                      contacted*      (untouched)
//
// Why `live` and not `fee_paid` for barter: there is no fee on a barter
// deal, so fee_paid would claim a payout with nothing behind it. `live` is
// the last rung before money on every route and is simply true.
//
// Why `fee_paid` only when the payment sheet says so: that is the one place
// in either workbook where a human wrote "Done" against a creator's name,
// which makes it the only place the database may claim money moved.
//
// Why blank leaves the application alone: 56 rows have no recorded progress.
// `contacted` is the strongest claim the sheet supports — they are on a
// hand-sourced list, so somebody DM'd them — and it sits BELOW
// SEAT_HOLDING_STAGES, which keeps 56 unconfirmed creators out of the seat
// count. Writing an application status here would assert a state nobody
// recorded, so blank never touches one.

export type BlankPolicy = "contacted" | "confirmed";

export type TargetState = {
  stage: HistoricalStage;
  // null = leave any existing application exactly as it is.
  applicationStatus: string | null;
  // Whether live_url / live_at should be written from the sheet.
  markLive: boolean;
};

export function deriveTargetState(input: {
  progress: VegaProgress;
  isBarter: boolean;
  paidOut: boolean;
  blankPolicy?: BlankPolicy;
}): TargetState {
  const { progress, isBarter, paidOut } = input;
  switch (progress) {
    case "live":
      if (!isBarter && paidOut) return { stage: "fee_paid", applicationStatus: "completed", markLive: true };
      if (isBarter) return { stage: "live", applicationStatus: "completed", markLive: true };
      return { stage: "live", applicationStatus: "live_submitted", markLive: true };
    case "draft_approval":
      return { stage: "draft_received", applicationStatus: "submitted", markLive: false };
    case "rework":
      return { stage: "revision_needed", applicationStatus: "revision_needed", markLive: false };
    case "in_progress":
      return { stage: "script_shared", applicationStatus: "approved", markLive: false };
    case "product_not_received":
      return { stage: "confirmed", applicationStatus: "approved", markLive: false };
    case "blank":
    default:
      return {
        stage: input.blankPolicy === "confirmed" ? "confirmed" : "contacted",
        applicationStatus: null,
        markLive: false,
      };
  }
}

// ── Application reconciliation guard ─────────────────────────────────────
//
// The import only ever moves an application FORWARD along this ladder, and
// never touches one that was decided against. So a second run is a no-op,
// and an admin who hand-corrected a row afterwards does not get it stomped.
const APPLICATION_LADDER = [
  "pending",
  "on_hold",
  "approved",
  "accepted",
  "submitted",
  "revision_needed",
  "live_submitted",
  "payment",
  "completed",
];

// Creator-initiated or deliberately decided. The sheet has no authority here.
const APPLICATION_FROZEN = new Set(["rejected", "withdrawn", "closed"]);

export function canAdvanceApplication(from: string, to: string): boolean {
  if (APPLICATION_FROZEN.has(from)) return false;
  const a = APPLICATION_LADDER.indexOf(from);
  const b = APPLICATION_LADDER.indexOf(to);
  // An unknown current status is left alone rather than guessed at.
  if (a < 0 || b < 0) return false;
  return b > a;
}

// ── The import marker ────────────────────────────────────────────────────
//
// Stored in campaign_bookings.notes using the INVITATION separator
// ("\n---\n", five characters) — not the campaign one ("\n\n---\n", six).
// Getting those two the wrong way round yields {} on parse, which reads as
// "no marker" and would make the import treat its own rows as hand-built.
// campaign_bookings.notes has no other parser, so this is free real estate.
const SEP = "\n---\n";

export type ImportMarker = { import: string; sheet?: string; line?: number };

// The trailer ALONE, separator included, to be appended after the prose has
// been clamped — see ImportRowInput.notesSuffix. Returning the whole notes
// string instead would mean clamping could cut the trailer off the end, and
// a marker-less row reads as hand-built and is then never refreshed.
export function importMarkerSuffix(meta: { sheet: string; line: number }): string {
  return SEP + JSON.stringify({ import: IMPORT_KEY, sheet: meta.sheet, line: meta.line });
}

export function readImportMarker(notes: string | null | undefined): ImportMarker | null {
  const s = String(notes ?? "");
  if (!s) return null;
  const at = s.lastIndexOf(SEP);
  const json = at >= 0 ? s.slice(at + SEP.length) : s;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && typeof parsed.import === "string") return parsed as ImportMarker;
  } catch {
    /* prose only */
  }
  return null;
}

// ── The payment workbook ─────────────────────────────────────────────────
//
// Two sheets, named the same as their counterparts in the main workbook. It
// is the only record of what was actually agreed and whether it was paid.
export type PaymentRow = {
  paidOut: boolean;
  finalPayment: string;
  agreedRupees: number | null;
  quotedRupees: number | null;
  email: string;
  phone: string;
  productSettled: boolean;
};

// "Done" and "Cleared" are the only two values that appear, across 10 rows.
const PAID_OUT = /^(done|cleared|paid|completed?)$/i;

export function parsePaymentRow(get: (field: string) => string): PaymentRow {
  const finalPayment = get("Final Payment").trim();
  const negotiated = parseCommercial(get("Negotiated Pricing"));
  return {
    paidOut: PAID_OUT.test(finalPayment),
    finalPayment,
    agreedRupees: negotiated.rupees,
    quotedRupees: parseMoney(get("Commercials")),
    email: get("Mail ID").trim().toLowerCase(),
    phone: get("Phone No.").trim(),
    productSettled: /reimburs/i.test(get("Product Status")),
  };
}

// ── Fulfilment route ─────────────────────────────────────────────────────
//
// Per BOOKING, not per campaign: on one campaign some creators were sent
// the product and others bought it and were paid back. The sheets say which
// by what they bothered to record.
//
//   an Order ID        WE ordered it for them, so it shipped
//   a product cost     they were out of pocket, so it was reimbursed
//   an address only    we needed somewhere to send it
//   nothing            reimburse, which is the column default anyway
export function deriveFulfilmentMode(row: {
  orderId?: string;
  productCost?: number | null;
  address?: string;
}): FulfilmentMode {
  if (row.orderId && row.orderId.trim()) return "ship";
  if (row.productCost && row.productCost > 0) return "reimburse";
  if (row.address && row.address.trim()) return "ship";
  return "reimburse";
}

// ── One row, fully derived ───────────────────────────────────────────────
//
// Everything the import needs for a single sheet row, so the panel only has
// to render it and the action only has to write it.

export type DerivedVegaRow = {
  handle: string;
  // The handle cell as written, so a skipped row can be diagnosed on screen.
  handleRaw: string;
  // True when an admin supplied the handle because the sheet's cell was wrong.
  corrected: boolean;
  sheet: string;
  line: number;
  // Carried through from the sheet unchanged, so the caller has everything
  // one booking needs without holding the parsed row alongside this.
  name: string;
  email: string;
  phone: string;
  address: string;
  tier: string;
  category: string;
  followers: number | null;
  productCost: number | null;
  stage: HistoricalStage;
  applicationStatus: string | null;
  progress: VegaProgress | null;
  quotedFee: number | null;
  agreedFee: number | null;
  fulfilmentMode: FulfilmentMode;
  liveUrl: string;
  liveAt: string | null;
  notes: string;
  notesSuffix: string;
  revisionNote: string;
  contactedAt: string | null;
  confirmedAt: string | null;
  scriptSharedAt: string | null;
  warnings: string[];
  // Set when the row cannot be imported at all.
  skipReason: string | null;
};

export function deriveVegaRow(
  row: SourcingImportRow,
  payment: PaymentRow | undefined,
  opts: { blankPolicy?: BlankPolicy; now?: Date; handleOverride?: string } = {},
): DerivedVegaRow {
  const warnings = [...row.warnings];
  const now = (opts.now ?? new Date()).toISOString();
  // An admin-confirmed correction for a cell the sheet got wrong (a reel URL
  // pasted over the profile link). Applied before anything else, so the row
  // then derives exactly as if the sheet had been right — including picking
  // up its payment row, which is keyed on the handle.
  const handle = (opts.handleOverride || row.handle).trim().toLowerCase();

  const progress = normalizeProgress(row.progress);
  if (progress === null) {
    warnings.push(`Progress "${row.progress}" isn't a value we recognise — row skipped`);
  }

  const commercial = parseCommercial(row.commercial);
  // The payment workbook is the authority on what was actually agreed; the
  // main sheet's Commercial column is only what was quoted.
  const agreedFee = payment?.agreedRupees ?? null;
  const quotedFee = commercial.rupees ?? payment?.quotedRupees ?? null;
  // Barter unless EITHER record names a fee.
  const isBarter = commercial.isBarter && agreedFee === null;

  const target =
    progress === null
      ? { stage: "contacted" as HistoricalStage, applicationStatus: null, markLive: false }
      : deriveTargetState({ progress, isBarter, paidOut: payment?.paidOut ?? false, blankPolicy: opts.blankPolicy });

  const fulfilmentMode = deriveFulfilmentMode(row);

  // Prose worth keeping: what the sheet said, in words, since the columns
  // themselves do not survive as columns.
  const proseParts = [row.notes];
  if (row.deliverables) proseParts.push(`Deliverables: ${row.deliverables}`);
  if (row.product) proseParts.push(`Product: ${row.product}`);
  if (row.orderId) proseParts.push(`Order ID: ${row.orderId}`);
  if (progress) proseParts.push(`Progress (sheet): ${PROGRESS_LABEL[progress]}`);
  if (payment?.finalPayment) proseParts.push(`Payment (sheet): ${payment.finalPayment}`);
  // A reimburse-route row that lands past the product leg can never have
  // its reimbursement queued, because product_approved is now behind it.
  // Say so on the booking rather than leaving a silent gap.
  if (fulfilmentMode === "reimburse" && row.productCost && row.productCost > 0) {
    proseParts.push(
      `Product Rs ${row.productCost} — settled before import; no reimbursement leg queued.`,
    );
  }

  const skipReason = isUnusableHandle(handle)
    ? `"${handle}" is not a usable Instagram handle — the IG Link cell holds ${
        /\/(reel|p)\//i.test(row.handleRaw) ? "a post link, not a profile link" : "something else"
      }`
    : progress === null
      ? `Unrecognised Progress value "${row.progress}"`
      : null;

  return {
    handle,
    handleRaw: row.handleRaw,
    corrected: !!opts.handleOverride && opts.handleOverride !== row.handle,
    sheet: row.sheet,
    line: row.line,
    name: row.name,
    email: payment?.email || row.email,
    phone: payment?.phone || row.phone,
    address: row.address,
    // NOT row.tier. parseSheet defaults tier to the sheet name, which is
    // right for the tier-split workbooks it was written for ("Macro") and
    // wrong here, where a sheet name is a campaign code — "VHSD-04(Paid)"
    // is not a follower tier. These sheets carry no tier column at all.
    tier: "",
    category: row.category,
    followers: row.followers,
    productCost: row.productCost,
    stage: target.stage,
    applicationStatus: target.applicationStatus,
    progress,
    quotedFee,
    agreedFee,
    fulfilmentMode,
    liveUrl: target.markLive ? row.liveUrl : "",
    // Fall back to now rather than leaving a live booking undated: the
    // sheet's Live Date is blank on 98 rows.
    liveAt: target.markLive ? (row.liveDate ?? now) : null,
    notes: proseParts.filter(Boolean).join(" · "),
    notesSuffix: importMarkerSuffix({ sheet: row.sheet, line: row.line }),
    revisionNote: target.stage === "revision_needed" ? "Imported: sheet said Video Rework" : "",
    // Everything imported was contacted at some point, by definition.
    contactedAt: now,
    confirmedAt: target.stage === "contacted" ? null : now,
    scriptSharedAt:
      target.stage === "script_shared" ||
      target.stage === "draft_received" ||
      target.stage === "revision_needed" ||
      target.stage === "live" ||
      target.stage === "fee_paid"
        ? now
        : null,
    warnings,
    skipReason,
  };
}

// ── Handles a sheet cannot answer for ────────────────────────────────────
//
// Two rows have a REEL url pasted into the IG Link column, which parses to
// the handle "reel". Importing that would create a creator called @reel and
// then need unpicking, so these are listed as skipped and the admin fixes
// the sheet — free, because the import is re-runnable by construction.
const NOT_A_HANDLE = /^(reel|reels|p|review|na|n\/a|tbd|yes|no|nil|none)$/i;

export function isUnusableHandle(handle: string): boolean {
  const h = String(handle || "").trim();
  if (!h) return true;
  if (NOT_A_HANDLE.test(h)) return true;
  // Instagram's own minimum is 1, but every real handle in these sheets is
  // well over 3, so a 1-3 character value is always a column mix-up.
  return h.length < 4;
}
