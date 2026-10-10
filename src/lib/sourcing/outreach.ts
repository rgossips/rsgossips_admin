// The outreach tracker's state machine.
//
// A sourced creator is a person somebody has to actually get hold of, and
// that was invisible before: a booking sat at `shortlisted` whether nobody
// had tried yet or three people had tried and given up. This adds the
// missing axis — who owns the conversation, what came back, and who signed
// off on the money.
//
// Plain module, NOT "use server": the table and the forms both need these
// labels and predicates, and a map exported from a "use server" file becomes
// a callable client ref.
//
// ── Why this is separate from `stage` ────────────────────────────────────
//
// `stage` says where the DELIVERABLE is. Outreach says whether we have
// reached the human. They are independent: "contacted, never picked up" tells
// you nothing about the product leg. But the two are kept in step here rather
// than left to drift, because an admin reads one row and expects it to make
// sense — so each outreach transition names the stage that goes with it, and
// every stage named below ALREADY EXISTS in BOOKING_STAGES. The DB's stage
// CHECK is untouched by this feature, which is why it needs no migration of
// its own.
//
//   added + assigned          -> shortlisted   (nobody has tried yet)
//   not picked up             -> contacted     (we tried; no answer)
//   declined by creator       -> declined      (their no)
//   price agreed              -> price_agreed  (goes up for sign-off)
//   approved                  -> confirmed     (the deal is on; takes a seat)
//   price rejected by us      -> cancelled     (our no — NOT `declined`,
//                                              which would misattribute it
//                                              to the creator)
//   sent back to renegotiate  -> price_agreed  (unchanged; it is still the
//                                              price under discussion)

import type { BookingStage } from "@/lib/sourcing/stages";

// What the creator said. NULL on a row means nobody has recorded a
// conversation yet, which is NOT the same as "no answer" — the difference is
// the whole point of having the field.
export const OUTREACH_STATUSES = ["not_picked_up", "declined", "agreed"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const OUTREACH_LABEL: Record<OutreachStatus, string> = {
  not_picked_up: "Not picked up",
  // "Did not agree", not "Declined": the stored value is `declined` and the
  // BOOKING STAGE of the same name means the creator said no to the
  // collaboration outright. This is the narrower thing — they talked to us
  // and the money did not work — and the admins asked for it in those words.
  declined: "Did not agree",
  agreed: "Agreed",
};

export const OUTREACH_TONE: Record<OutreachStatus, string> = {
  not_picked_up: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  declined: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  agreed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

// The price sign-off, once there is a price to sign off.
export const APPROVAL_STATES = ["pending", "approved", "rejected", "renegotiate"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const APPROVAL_LABEL: Record<ApprovalState, string> = {
  pending: "Waiting for sign-off",
  approved: "Approved",
  rejected: "Price rejected",
  renegotiate: "Back for renegotiation",
};

export const APPROVAL_TONE: Record<ApprovalState, string> = {
  pending: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  renegotiate: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

export function isOutreachStatus(v: unknown): v is OutreachStatus {
  return typeof v === "string" && (OUTREACH_STATUSES as readonly string[]).includes(v);
}
export function isApprovalState(v: unknown): v is ApprovalState {
  return typeof v === "string" && (APPROVAL_STATES as readonly string[]).includes(v);
}

/** The stage that goes with an outreach outcome. */
export function stageForOutreach(status: OutreachStatus): BookingStage {
  if (status === "declined") return "declined";
  if (status === "agreed") return "price_agreed";
  return "contacted";
}

/** The stage that goes with an approval decision. */
export function stageForApproval(state: Exclude<ApprovalState, "pending">): BookingStage {
  if (state === "approved") return "confirmed";
  // Our refusal, not the creator's. `declined` is reserved for their no, so
  // attributing this to them would make the funnel lie about why a booking
  // died.
  if (state === "rejected") return "cancelled";
  return "price_agreed";
}

// ── Who may do what ──────────────────────────────────────────────────────
//
// Recording an outcome belongs to whoever owns the conversation, because
// they are the only one who had it. A super_admin can step in — people go on
// leave mid-negotiation and the row should not be stuck. An approver cannot
// record an outcome on a row assigned to someone else just by holding the
// approver flag: approving is a different job from negotiating, and letting
// one person do both on the same row removes the second pair of eyes that is
// the entire reason for the sign-off step.

export type ActorContext = {
  actorId: string;
  isSuperAdmin: boolean;
  isApprover: boolean;
};

// A super_admin can change ANYTHING on the tracker, at any point, including
// a row that has already been settled. This is deliberate and it is the one
// rule that overrides the rest: the workflow has handoffs in it, people go
// on leave mid-negotiation, and somebody records the wrong outcome — a
// process with no way to correct itself just produces rows that quietly
// stop being true. The audit trail is what makes that safe rather than the
// absence of the ability: every one of these writes a campaign_booking_events
// row and an admin_activity_log entry naming who did it.
//
// THESE TWO FUNCTIONS ARE THE ONLY OWNERS of the rule. The row controls
// import them rather than re-deriving — they had their own copies for one
// commit and that is exactly how a UI starts offering a button the server
// then refuses.

export function canRecordOutcome(
  booking: {
    assigned_to?: string | null;
    approval_state?: string | null;
    outreach_status?: string | null;
  },
  actor: ActorContext,
): boolean {
  if (actor.isSuperAdmin) return true;
  // For everyone else the row has to be theirs AND still open: a price
  // already up for sign-off is out of the negotiator's hands, and a settled
  // row is settled.
  if (booking.approval_state === "pending") return false;
  if (booking.approval_state === "approved" || booking.approval_state === "rejected") return false;
  if (booking.outreach_status === "declined") return false;
  return !!booking.assigned_to && booking.assigned_to === actor.actorId;
}

export function canDecideApproval(
  booking: {
    approval_state?: string | null;
    outreach_owner?: string | null;
    outreach_status?: string | null;
  },
  actor: ActorContext,
): boolean {
  // Something has to be on the table: either a price awaiting sign-off, a
  // decision already made that could be revised, or an agreed amount that
  // never went up because nobody held the approver flag at the time.
  const decidable =
    !!booking.approval_state || booking.outreach_status === "agreed";
  if (!decidable) return false;

  if (actor.isSuperAdmin) return true;
  if (!actor.isApprover) return false;
  // Only a live request, for a normal approver — re-opening a settled
  // decision is a super_admin's call.
  if (booking.approval_state !== "pending") return false;
  // The negotiator does not sign off on their own agreed price. That second
  // pair of eyes is the entire reason the step exists.
  if (booking.outreach_owner === actor.actorId) return false;
  return true;
}

/**
 * Is this row still live, or has it ended?
 *
 * Used to grey out finished rows rather than hide them — an admin looking at
 * a campaign wants to see the people who said no, not a list that quietly
 * shrinks.
 */
export function isOutreachClosed(booking: {
  outreach_status?: string | null;
  approval_state?: string | null;
}): boolean {
  return booking.outreach_status === "declined" || booking.approval_state === "rejected";
}

/**
 * One line describing what the row is waiting on, for the table.
 *
 * `stage` is consulted as a fallback because the tracker arrived AFTER the
 * bookings did: 63 rows already exist with outreach_status NULL, several of
 * them at `price_agreed` from the hand-sourcing this replaces. Reading only
 * the outreach fields would caption every one of those "Not contacted yet",
 * which is plainly false for a creator somebody already negotiated with —
 * so a row with no recorded outreach but a stage past the start says that
 * it predates the tracker instead of inventing a status for it.
 */
export function outreachSummary(booking: {
  assigned_to?: string | null;
  outreach_status?: string | null;
  approval_state?: string | null;
  stage?: string | null;
}): string {
  if (booking.approval_state === "approved") return "Approved — application created";
  if (booking.approval_state === "rejected") return "Price rejected";
  if (booking.approval_state === "pending") return "Waiting for sign-off";
  if (booking.approval_state === "renegotiate") return "Back for renegotiation";
  if (booking.outreach_status === "declined") return "Creator declined";
  if (booking.outreach_status === "not_picked_up") return "No answer yet";
  if (booking.outreach_status === "agreed") return "Amount agreed";

  // Nothing recorded on the outreach axis. Was anything recorded at all?
  const stage = String(booking.stage || "");
  if (stage && stage !== "shortlisted") return "Tracked before the outreach tracker";
  if (!booking.assigned_to) return "Unassigned";
  return "Not contacted yet";
}
