// Plain module, NOT "use server": every export from a "use server" file
// becomes a callable client ref at import time, so constants live apart.

/**
 * Candidates tiered per request.
 *
 * Each one is a separate paid HikerAPI lookup taking 1–2s, so this is bounded
 * by Netlify's function timeout rather than by taste — the same reason bulk
 * invite and photo enrichment chunk at 5. The client drives the chunks so the
 * admin watches the spend happen and can stop.
 */
export const TIER_CHUNK = 5;

/**
 * Hard cap on candidates tiered in one run.
 *
 * The balance is prepaid and was 1,713 requests when this shipped. A run that
 * tiers 40 people is ~2.3% of it; without a cap, a few enthusiastic searches
 * would empty the account and every other HikerAPI feature in the portal —
 * the add-creator Fetch button, "Update missing details" — would start
 * failing with a 402 that looks like a bug.
 */
export const MAX_TIER_PER_RUN = 40;

/** Rate limit: tiering calls per admin per hour. */
export const TIER_RATE_LIMIT = 300;

/** Searches per admin per hour. Cheap, but not free. */
export const SEARCH_RATE_LIMIT = 60;
