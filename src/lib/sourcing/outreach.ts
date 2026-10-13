// Who may move a booking, and what the move is called.
//
// The pipeline in stages.ts says WHICH stage comes next; this says who is
// allowed to make it happen and what the button should say.
//
// ── Why this file shrank ────────────────────────────────────────────────
//
// It used to carry its own `outreach_status` (not picked up / did not agree
// / agreed) and `approval_state` (pending / approved / rejected /
// renegotiate) machinery, running as a second axis beside `stage`. The
// nine-stage pipeline absorbed both: `quote_review` IS "agreed, awaiting
// sign-off", `dropped` IS "declined", and the stage's own actor says
// whether we are waiting on the team or the approver. Two sources of truth
// for one question is how a row ends up claiming to be approved and
// not-yet-contacted at the same time.
//
// The columns still exist and 64 rows carry values — nothing reads them to
// decide anything now, and they are left alone rather than wiped, because
// they are the only record of what those rows were before the change.

import { stageIndex, stageSpec, type BookingStage } from "@/lib/sourcing/stages";

export type ActorContext = {
  actorId: string;
  /** Display name, for "waiting on …". */
  name: string;
  isSuperAdmin: boolean;
  isApprover: boolean;
  isViewer: boolean;
};

export type ActorBooking = {
  stage: string;
  /** The team member who owns reaching out. */
  assigned_to?: string | null;
};

/**
 * Whose move it is: the owning team member, an approver, or nobody.
 *
 * Returns an admin id for the team, the literal "approver" for an approver
 * stage (any approver will do, so there is no single id), and null once the
 * row is closed or dropped.
 */
export function actorFor(booking: ActorBooking): { kind: "team" | "approver" | "none"; adminId: string | null } {
  const spec = stageSpec(booking.stage);
  if (!spec.actor) return { kind: "none", adminId: null };
  if (spec.actor === "approver") return { kind: "approver", adminId: null };
  return { kind: "team", adminId: booking.assigned_to ?? null };
}

/**
 * May this person move the row right now?
 *
 * A super_admin can always act — people go on leave mid-negotiation, and a
 * process with no way to correct itself produces rows that quietly stop
 * being true. The audit trail is what makes that safe rather than the
 * absence of the ability: every move writes a campaign_booking_events row
 * naming who made it.
 */
export function canAct(booking: ActorBooking, actor: ActorContext): boolean {
  if (actor.isViewer) return false;
  if (actor.isSuperAdmin) return true;
  const who = actorFor(booking);
  if (who.kind === "none") return false;
  if (who.kind === "approver") return actor.isApprover;
  // A team stage: the owner acts on it. Unassigned rows are open to any
  // admin, so a creator cannot get stranded because nobody was picked.
  return !who.adminId || who.adminId === actor.actorId;
}

/** One line for the row: "Your move" / "Waiting on Saquib" / "". */
export function waitingLabel(
  booking: ActorBooking,
  actor: ActorContext,
  nameOf: (adminId: string) => string,
  approverName: string,
): string {
  const who = actorFor(booking);
  if (who.kind === "none") return "";
  if (canAct(booking, actor)) return "Your move";
  if (who.kind === "approver") return `Waiting on ${approverName}`;
  return who.adminId ? `Waiting on ${nameOf(who.adminId)}` : "Unassigned";
}

// ── The moves ────────────────────────────────────────────────────────────
//
// Each stage offers one or two named transitions. Listed here rather than
// derived, because unlike a ladder these are not all "forward": requesting
// changes goes back to `content`, negotiating goes back to `outreach`, and
// a creator can be dropped from several places. A derived version would
// need the exceptions spelled out anyway, and then the exceptions would be
// the real list.

export type MoveId =
  | "approveCreator"
  | "rejectCreator"
  | "markReached"
  | "submitQuote"
  | "declined"
  | "approveQuote"
  | "negotiate"
  | "markReimbursed"
  | "submitContent"
  | "approveContent"
  | "requestChanges"
  | "closeDeal"
  | "reopen"
  | "dropCreator";

export const MOVES: Record<MoveId, { to: BookingStage; verb: string }> = {
  approveCreator: { to: "shortlisted", verb: "approved creator" },
  rejectCreator: { to: "dropped", verb: "marked creator not a fit" },
  markReached: { to: "outreach", verb: "reached out" },
  submitQuote: { to: "quote_review", verb: "sent agreed quote for approval" },
  declined: { to: "dropped", verb: "marked creator declined" },
  approveQuote: { to: "product", verb: "approved quote" },
  negotiate: { to: "outreach", verb: "asked to negotiate further" },
  markReimbursed: { to: "content", verb: "marked product bought and reimbursed" },
  submitContent: { to: "content_review", verb: "sent content for review" },
  approveContent: { to: "payout", verb: "approved content" },
  requestChanges: { to: "content", verb: "requested changes" },
  closeDeal: { to: "closed", verb: "settled and closed" },
  reopen: { to: "shortlisted", verb: "reopened as shortlisted" },
  dropCreator: { to: "dropped", verb: "declined" },
};

/**
 * Declining is available from ANY stage, which is why it is not in
 * MOVES_FROM with the rest.
 *
 * The pipeline's own moves are about progress — each one answers the
 * question that stage asks. Dropping out is not a stage question: a creator
 * can stop replying after the product has shipped, or pull out once the
 * content is written. A decline that only worked from `outreach` meant a
 * row that died later had nowhere to go but `closed`, which claimed a
 * collaboration that never happened.
 *
 * `dropped` is absent from SEAT_HOLDING_STAGES, so this frees the seat as a
 * consequence of the move rather than through separate bookkeeping that
 * could drift from it.
 */
export function canDrop(booking: { stage: string }): boolean {
  return booking.stage !== "dropped";
}

/**
 * Declining a creator we were committed to needs a reason on the record.
 *
 * Past the quote approval there is usually money involved — a reimbursed
 * product, a fee agreed — and "why did this one stop" is the question
 * somebody asks three weeks later. Before that it is just a conversation
 * that went nowhere, and demanding an essay for each one would get an "x"
 * typed into the box.
 */
export function dropNeedsReason(booking: { stage: string }): boolean {
  return stageIndex(booking.stage) >= stageIndex("product");
}

/** Which moves are offered from a stage, in button order. */
export const MOVES_FROM: Record<string, MoveId[]> = {
  proposed: ["approveCreator", "rejectCreator"],
  shortlisted: ["markReached"],
  outreach: ["submitQuote", "declined"],
  quote_review: ["approveQuote", "negotiate"],
  product: ["markReimbursed"],
  content: ["submitContent"],
  content_review: ["approveContent", "requestChanges"],
  payout: ["closeDeal"],
  closed: [],
  dropped: ["reopen"],
};

export function movesFrom(stage: string): MoveId[] {
  return MOVES_FROM[stage] ?? [];
}

/** Reopening a dropped row is an approver's call, not the team's. */
export function moveNeedsApprover(move: MoveId): boolean {
  return move === "reopen";
}
