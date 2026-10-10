// The managed-sourcing stage machine.
//
// Plain module, NOT "use server" — every export from a "use server" file
// becomes a callable client ref, so constants and types have to live apart
// (same split as lib/nudges/constants.ts).
//
// A sourced creator walks a longer road than a self-serve applicant: we find
// them, DM them, haggle, confirm, get a product into their hands, share a
// script, collect a video, get it approved twice, watch it go live, and pay
// them. Each of those is a stage because an admin needs to answer "where is
// everyone" at a glance, and because the spreadsheet this replaces had a
// column for each.
//
// Money is deliberately NOT a stage. Payout legs are queued BY transitions
// (see PAYOUT_ON_ENTER), so "product paid, video late" is representable —
// which a single linear status could not say.
//
// The DB has a CHECK constraint on these values (rgossips_web migration 081).
// Deploy the migration before shipping a new stage or the write is a hard 400.

export const BOOKING_STAGES = [
  "shortlisted",
  "contacted",
  "price_agreed",
  "confirmed",
  "product_purchased",
  "product_approved",
  "reimbursed",
  "product_shipped",
  "product_delivered",
  "script_shared",
  "draft_received",
  "revision_needed",
  "admin_approved",
  "brand_approved",
  "live",
  "fee_paid",
  "declined",
  "cancelled",
] as const;

export type BookingStage = (typeof BOOKING_STAGES)[number];

// How the product reaches this particular creator. Per booking, because on
// one campaign some are sent the product and others are asked to buy it —
// the Vega sheet carried a product cost AND delivery addresses for exactly
// that reason.
//
//   reimburse — they buy it, we approve the receipt, we pay them back
//   ship      — we send it, we record tracking, they confirm arrival
//   none      — a service or a stay: no parcel, no money for a product
export const FULFILMENT_MODES = ["reimburse", "ship", "none"] as const;
export type FulfilmentMode = (typeof FULFILMENT_MODES)[number];

export function toFulfilmentMode(value: unknown): FulfilmentMode {
  return value === "ship" || value === "none" ? value : "reimburse";
}

/**
 * The route a campaign's bookings should default to, read off its brief.
 *
 * Here rather than in a page because two pages now offer "add creators" — the
 * outreach tracker and the campaign detail page's creator finder — and a
 * second copy of this would drift the first time the brief grew a field.
 *
 * KNOWN GAP: `fulfilment_mode` is written only at creation (addBooking, the
 * pool import, the sheet import) and there is no UI to change it afterwards,
 * so whatever this returns is what that booking is stuck with. That was
 * already true when the add form had a mode selector — the selector only
 * moved the guess earlier — but it matters more now the selector is gone.
 * If a creator needs a different route, the booking has to be recreated.
 *
 *   ships it                  -> we send it, so `ship`
 *   pickup                    -> the creator collects; no parcel of ours
 *   a product, but no shipping -> they buy it and we pay them back
 *   a service or a stay       -> nothing physical moves
 */
export function defaultFulfilmentMode(meta: {
  shipping_required?: unknown;
  offering_type?: unknown;
}): FulfilmentMode {
  if (meta.shipping_required === "yes") return "ship";
  if (meta.shipping_required === "pickup") return "none";
  return meta.offering_type === "product" ? "reimburse" : "none";
}

export const FULFILMENT_MODE_LABEL: Record<FulfilmentMode, string> = {
  reimburse: "Creator buys · we reimburse",
  ship: "We ship it",
  none: "Nothing to send",
};

// The product leg of each route. Everything from script_shared onward is
// shared, so only this middle section differs.
const PRODUCT_LEG: Record<FulfilmentMode, BookingStage[]> = {
  reimburse: ["product_purchased", "product_approved", "reimbursed"],
  ship: ["product_shipped", "product_delivered"],
  none: [],
};

// Off the main road: reachable from anywhere, and nothing follows them.
export const TERMINAL_STAGES: BookingStage[] = ["declined", "cancelled"];

// The happy path for a given route, in order. Used for the funnel and for
// "what comes next".
export function mainPath(mode: FulfilmentMode = "reimburse"): BookingStage[] {
  return [
    "shortlisted",
    "contacted",
    "price_agreed",
    "confirmed",
    ...PRODUCT_LEG[mode],
    "script_shared",
    "draft_received",
    "admin_approved",
    "brand_approved",
    "live",
    "fee_paid",
  ];
}

// Every stage any route can visit, in a sensible display order — for the
// funnel on a campaign whose bookings use both routes.
export const ALL_MAIN_STAGES: BookingStage[] = [
  "shortlisted",
  "contacted",
  "price_agreed",
  "confirmed",
  "product_purchased",
  "product_approved",
  "reimbursed",
  "product_shipped",
  "product_delivered",
  "script_shared",
  "draft_received",
  "revision_needed",
  "admin_approved",
  "brand_approved",
  "live",
  "fee_paid",
];

// What may follow what, for one route. Derived from mainPath so the two
// cannot drift, with the handful of back-edges spelled out: a bad receipt
// goes back a step, a revision loops.
//
// An admin can always decline or cancel, so those are appended rather than
// written out seventeen times.
const BACK_EDGES: Partial<Record<BookingStage, BookingStage[]>> = {
  product_purchased: ["confirmed"],   // the receipt was wrong — ask again
  product_shipped: ["confirmed"],     // wrong address, send again
  product_delivered: ["product_shipped"],
  draft_received: ["revision_needed"],
  revision_needed: ["draft_received"],
};

export function nextStages(stage: BookingStage, mode: FulfilmentMode = "reimburse"): BookingStage[] {
  if (TERMINAL_STAGES.includes(stage)) return [];
  const path = mainPath(mode);
  const i = path.indexOf(stage);
  const onward: BookingStage[] = [];
  // revision_needed is off the main path; its only way forward is back to
  // the draft.
  if (i >= 0 && i < path.length - 1) onward.push(path[i + 1]);
  onward.push(...(BACK_EDGES[stage] ?? []));
  return [...new Set([...onward, ...TERMINAL_STAGES])];
}

export function canTransition(from: BookingStage, to: BookingStage, mode: FulfilmentMode = "reimburse"): boolean {
  return nextStages(from, mode).includes(to);
}

export function isBookingStage(value: unknown): value is BookingStage {
  return typeof value === "string" && (BOOKING_STAGES as readonly string[]).includes(value);
}

// Entering these stages queues money. Kept here rather than in the action so
// the rule is visible beside the stage it belongs to.
//
//  product_approved — the creator is out of pocket for something they bought
//                     on our say-so, so the reimbursement is due immediately.
//  live             — the fee falls due 48h after the post went live, which
//                     is the promise the manual process has always made and
//                     never been able to keep. (Self-serve is plan-tiered at
//                     7/3/0 days; this flow is its own agreement.)
export const PAYOUT_ON_ENTER: Partial<
  Record<BookingStage, { kind: "product_reimbursement" | "fee"; dueAfterHours: number }>
> = {
  // Only reachable on the reimburse route — a creator who was SENT the
  // product was never out of pocket, so there is nothing to pay back. The
  // stage machine enforces that; this map only says what a stage costs.
  product_approved: { kind: "product_reimbursement", dueAfterHours: 0 },
  live: { kind: "fee", dueAfterHours: 48 },
};

// Which stages occupy one of the campaign's seats. Everything before
// `confirmed` is pipeline — a maybe, not a booking — and the two terminal
// stages never count. See lib/sourcing/seats.ts, which owns the total.
export const SEAT_HOLDING_STAGES: BookingStage[] = [
  "confirmed",
  "product_purchased",
  "product_approved",
  "reimbursed",
  "product_shipped",
  "product_delivered",
  "script_shared",
  "draft_received",
  "revision_needed",
  "admin_approved",
  "brand_approved",
  "live",
  "fee_paid",
];

export function holdsSeat(stage: string): boolean {
  return SEAT_HOLDING_STAGES.includes(stage as BookingStage);
}

export const STAGE_LABEL: Record<BookingStage, string> = {
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  price_agreed: "Price agreed",
  confirmed: "Confirmed",
  product_purchased: "Product purchased",
  product_approved: "Receipt approved",
  reimbursed: "Reimbursed",
  product_shipped: "Product shipped",
  product_delivered: "Product delivered",
  script_shared: "Script shared",
  draft_received: "Draft received",
  revision_needed: "Revision needed",
  admin_approved: "Approved by us",
  brand_approved: "Approved by brand",
  live: "Live",
  fee_paid: "Fee paid",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const STAGE_STYLE: Record<BookingStage, string> = {
  shortlisted: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  contacted: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  price_agreed: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  confirmed: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  product_purchased: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  product_approved: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  reimbursed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  product_shipped: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  product_delivered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  script_shared: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  draft_received: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  revision_needed: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  admin_approved: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  brand_approved: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  live: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  fee_paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  declined: "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};
