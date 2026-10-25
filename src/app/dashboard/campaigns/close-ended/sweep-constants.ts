// Plain module, NOT "use server": every export from a "use server" file
// becomes a callable client ref at import time, so constants live apart
// (same split as campaign-transition-constants.ts and delete-steps.ts).

/**
 * Creators notified per request.
 *
 * Smaller than it looks because each one costs a suggestions query, an SMTP
 * send and a notification insert, and SMTP is the slow part — the existing
 * transition flow uses 5 for the same reason and Netlify's function timeout
 * is short. The client drives the chunks so the admin watches progress
 * rather than staring at a spinner that may be about to time out.
 */
export const SWEEP_NOTIFY_CHUNK = 5;
