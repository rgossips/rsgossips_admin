// Plain module, NOT "use server": every export from a "use server" file
// becomes a callable client ref at import time, so constants have to live
// apart (same split as enrich-constants.ts and delete-steps.ts).

// Creators told per server call. Each one sends an email over SMTP and
// writes a notification, so the chunk stays small — Netlify's function
// timeout is short and the admin is watching a progress list, which only
// reads as progress if it moves.
export const COMING_SOON_CHUNK = 5;

// Application statuses worth parking and telling. A withdrawn or rejected
// application is already settled, and a completed one has been paid —
// reopening either conversation would be noise.
export const AFFECTED_STATUSES = [
  "pending",
  "on_hold",
  "approved",
  "submitted",
  "revision_needed",
  "accepted",
] as const;
