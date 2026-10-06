// Plain module, NOT "use server": every export from a "use server" file
// becomes a callable client ref at import time, so constants live apart
// (same split as enrich-constants.ts and delete-steps.ts).

/**
 * Winding a live campaign down comes in two shapes, and they are NOT the
 * same thing — which is why the affected sets differ:
 *
 *   coming_soon — the campaign is coming BACK. Everything mid-flight is
 *                 parked at on_hold, including approved and submitted work,
 *                 because all of it resumes when the campaign reopens.
 *
 *   closed      — the campaign is over. Only UNDECIDED applications are
 *                 closed. An approved or submitted creator did the work;
 *                 closing their application would erase that, and they are
 *                 owed a decision (or a payout), not a tidy-up.
 */
export type TransitionMode = "coming_soon" | "closed" | "reopen";

export const TRANSITION_CHUNK = 5;

export const COMING_SOON_AFFECTED = [
  "pending",
  "on_hold",
  "approved",
  "submitted",
  "revision_needed",
  "accepted",
] as const;

export const CLOSED_AFFECTED = ["pending", "on_hold"] as const;

// Reopening. The applications parked when the campaign was pulled back go
// to the front of the queue again.
//
// This mode exists because without it the promise the coming-soon email
// makes — "we'll tell you the moment it reopens" — was never kept: the
// campaign went live and every parked application sat at on_hold forever.
//
// `on_hold` is overloaded: it means both "parked because the campaign was
// pulled" and "shortlisted by an admin". Nothing in the row distinguishes
// them, so this does NOT guess — the admin is shown the list and confirms
// it, which is also why the restore is a modal and not a side effect of
// changing the status.
export const REOPEN_AFFECTED = ["on_hold"] as const;

export function affectedStatuses(mode: TransitionMode): readonly string[] {
  if (mode === "closed") return CLOSED_AFFECTED;
  if (mode === "reopen") return REOPEN_AFFECTED;
  return COMING_SOON_AFFECTED;
}

/** The status each application lands on. */
export function targetStatus(mode: TransitionMode): string {
  if (mode === "closed") return "closed";
  // The old application ENDS. Creators re-apply when a campaign reopens —
  // the brief may have changed while it was being prepared, and a months-old
  // application is not evidence of present interest.
  //
  // `closed` specifically, because apply-campaign only lets a creator apply
  // again over a FINISHED application: left at on_hold they would be told
  // "you have already applied" and locked out of the campaign they were just
  // invited back to.
  if (mode === "reopen") return "closed";
  return "on_hold";
}

/** The campaign status the admin is moving TO. */
export function campaignStatusFor(mode: TransitionMode, requested: string): string {
  return mode === "coming_soon" ? "coming_soon" : requested;
}
