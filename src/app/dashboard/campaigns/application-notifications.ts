// What the creator is told for each decision we make on their application.
//
// Plain module, NOT "use server": it lived inside actions.ts as a private
// const, which was fine while that file was the only writer. Now the bulk
// reject needs the same copy, and a map exported from a "use server" file
// becomes a callable client ref at import time rather than an object — the
// same split as delete-steps.ts beside delete-actions.ts.
//
// Types are the app_* family the consumer app already renders and routes:
// its getNotifLink() sends any app_* carrying a campaignId to
// /influencer/offers/<id>, and prefKeyForType() maps app_* to the
// "applicationStatus" preference so a creator who muted these still won't be
// pushed. Statuses absent from this map (withdrawn, payment, live_submitted,
// submitted) are either creator-initiated or already notified elsewhere —
// escrow-release owns the payout messages — so they stay silent here.
export const APPLICATION_NOTIFICATIONS: Record<
  string,
  { type: string; title: string; text: (campaign: string) => string }
> = {
  // The creator hears "shortlisted", not "on hold". Both describe the same
  // row, but the admin is parking a decision while the creator is being told
  // they made the cut so far — and "on hold" reads to them as a rejection
  // with extra steps. The copy is careful not to promise approval.
  on_hold: {
    type: "app_on_hold",
    title: "You've been shortlisted",
    text: (c) => `You're shortlisted for "${c}". The final selection isn't made yet — we'll let you know either way.`,
  },
  approved: {
    type: "app_approved",
    title: "Application approved",
    text: (c) => `You're approved for "${c}". Check the brief and start creating.`,
  },
  accepted: {
    type: "app_accepted",
    title: "Work accepted",
    text: (c) => `Your submission for "${c}" was accepted.`,
  },
  rejected: {
    type: "app_rejected",
    title: "Application not accepted",
    text: (c) => `Your application for "${c}" wasn't accepted this time.`,
  },
  revision_needed: {
    type: "app_revision_needed",
    title: "Changes requested",
    text: (c) => `The brand asked for changes to your submission for "${c}".`,
  },
  completed: {
    type: "app_completed",
    title: "Campaign completed",
    text: (c) => `"${c}" is marked complete. Nice work.`,
  },
};
