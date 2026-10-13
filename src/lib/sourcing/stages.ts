// The outreach pipeline.
//
// Nine stages that alternate between the TEAM (whoever owns the creator)
// and the APPROVER, so a row answers "whose move is it" from one column
// instead of three. That alternation is the whole design: every stage names
// an actor, and the UI derives "your move" / "waiting on Saquib" from it
// rather than from a separate assignment field that could disagree.
//
// This replaced an 18-stage ladder that branched on fulfilment_mode. That
// one modelled the product leg in fine detail — shipped vs purchased vs
// nothing — and said nothing about who was waiting. The replacement folds
// the product leg into one `product` stage, because in practice the team
// does the same thing either way: get the product to the creator, record
// what it cost, move on.
//
// The DB has a CHECK on these values (rgossips_web migration 085). Deploy
// the migration before shipping a new stage or the write is a hard 400.
//
// Plain module, NOT "use server" — the table, the detail panel and the
// server actions all read these.

export const BOOKING_STAGES = [
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

export type BookingStage = (typeof BOOKING_STAGES)[number];

/** Who the pipeline is waiting on. `null` means nobody — it has ended. */
export type StageActor = "team" | "approver" | null;

export type StageSpec = {
  id: BookingStage;
  label: string;
  actor: StageActor;
  /** What that actor has to do, in their words. */
  next: string;
};

// The happy path, in order. `closed` ends it; `dropped` is off to one side
// and reachable from anywhere, so it is NOT in here — PIPELINE is what the
// progress list and the "how far along" index are built from.
export const PIPELINE: StageSpec[] = [
  { id: "proposed", label: "Creator approval", actor: "approver", next: "Approve creator and quote" },
  { id: "shortlisted", label: "Shortlisted", actor: "team", next: "Reach out by email or DM" },
  { id: "outreach", label: "In outreach", actor: "team", next: "Close on a quote" },
  { id: "quote_review", label: "Quote approval", actor: "approver", next: "Approve the agreed quote" },
  { id: "product", label: "Product & reimburse", actor: "team", next: "Creator buys product, team reimburses" },
  { id: "content", label: "Content in progress", actor: "team", next: "Collect review and reels" },
  { id: "content_review", label: "Content review", actor: "approver", next: "Review the submitted content" },
  { id: "payout", label: "Payment / barter", actor: "approver", next: "Pay or send barter product" },
  { id: "closed", label: "Closed", actor: null, next: "Done" },
];

export const DROPPED: StageSpec = { id: "dropped", label: "Dropped", actor: null, next: "Not proceeding" };

const BY_ID = new Map<string, StageSpec>([...PIPELINE, DROPPED].map((s) => [s.id, s]));

export function stageSpec(stage: string): StageSpec {
  // An unknown value reads as Dropped rather than throwing. A booking whose
  // stage the DB somehow holds and this list does not is still a row an
  // admin has to be able to see.
  return BY_ID.get(stage) ?? DROPPED;
}

/** Position on the happy path, or -1 for dropped / unknown. */
export function stageIndex(stage: string): number {
  return PIPELINE.findIndex((s) => s.id === stage);
}

export function isBookingStage(value: unknown): value is BookingStage {
  return typeof value === "string" && (BOOKING_STAGES as readonly string[]).includes(value);
}

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  [...PIPELINE, DROPPED].map((s) => [s.id, s.label]),
);

// Tone per stage, by WHO is waiting rather than by position: an admin
// scanning the list is looking for their own work, and colouring by actor
// makes that one glance instead of reading every label.
export const STAGE_STYLE: Record<string, string> = Object.fromEntries(
  [...PIPELINE, DROPPED].map((s) => [
    s.id,
    s.id === "closed"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : s.id === "dropped"
        ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        : s.actor === "approver"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  ]),
);

/** Still being worked, as opposed to closed or dropped. */
export function isActiveStage(stage: string): boolean {
  return stage !== "closed" && stage !== "dropped";
}

// Which stages occupy one of the campaign's seats.
//
// A seat is taken when the APPROVER SIGNS OFF THE QUOTE — `product` is the
// first stage past that gate — and not before. Everything earlier is a
// conversation: `proposed` may be rejected, `shortlisted` and `outreach`
// may come to nothing, and `quote_review` is a price that has been asked
// for and not yet agreed to. Counting those would let a campaign of 20
// seats fill up with maybes while the creators actually committed to had
// nowhere to go.
//
// `dropped` never counts; `closed` does, because that creator used a seat
// and delivered.
//
// See lib/sourcing/seats.ts, which owns the total across both intake paths.
export const SEAT_HOLDING_STAGES: BookingStage[] = [
  "product",
  "content",
  "content_review",
  "payout",
  "closed",
];

export function holdsSeat(stage: string): boolean {
  return (SEAT_HOLDING_STAGES as string[]).includes(stage);
}

// ── Fulfilment mode ──────────────────────────────────────────────────────
//
// Kept ONLY because the column exists and 64 rows carry a value. The
// pipeline no longer branches on it: `product` covers every route, since
// the team's job is the same in each case — get the product there, record
// what it cost. Nothing new sets it, and nothing reads it to decide a
// stage. It is a note on the row, not a fork in the road.
export const FULFILMENT_MODES = ["reimburse", "ship", "none"] as const;
export type FulfilmentMode = (typeof FULFILMENT_MODES)[number];

export function toFulfilmentMode(value: unknown): FulfilmentMode {
  return value === "ship" || value === "none" ? value : "reimburse";
}

export const FULFILMENT_MODE_LABEL: Record<FulfilmentMode, string> = {
  reimburse: "Creator buys · we reimburse",
  ship: "We ship it",
  none: "Nothing to send",
};

/**
 * The route a campaign's bookings default to, read off its brief.
 *
 * Still here because the add forms record it, and knowing whether anything
 * physical moves is useful on the row. It no longer decides the ladder.
 */
export function defaultFulfilmentMode(meta: {
  shipping_required?: unknown;
  offering_type?: unknown;
}): FulfilmentMode {
  if (meta.shipping_required === "yes") return "ship";
  if (meta.shipping_required === "pickup") return "none";
  return meta.offering_type === "product" ? "reimburse" : "none";
}

// How a closed collaboration was settled.
export const PAYOUT_MODES = ["Cash", "Barter"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];
