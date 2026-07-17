// Plain module — NOT "use server". Every export from a "use server" file
// becomes a callable client ref, so types/constants must live here.
// See enrich-actions.ts for the runner.

// Instagram lookups are network-bound (~1-2s each) and Netlify's function
// timeout is short, so the client walks the work-list in small chunks and
// calls the action once per chunk — the same shape bulk-invite uses. Items
// within a chunk run in parallel, so a chunk costs roughly one round trip.
// Keep this small: a chunk that times out loses the whole chunk's API spend.
export const ENRICH_CHUNK_SIZE = 5;

// Fields that decide whether a row counts as "missing details".
//
// ONLY fields HikerAPI returns for every reachable account belong here —
// measured live at a 100% fill rate. Put a patchy field in this list and the
// scan stops converging: rows that legitimately have no value would be listed
// (and re-bought) on every single run, forever.
//
// Deliberately excluded despite being filled opportunistically:
//   bio, businessCategory  — a creator can genuinely have neither
//   email (75%), externalUrl (38%), phone (0%) — mostly absent in practice
export const CORE_FIELDS = [
  "photo",
  "followers",
  "follows",
  "posts",
  "verified",
  "isPrivate",
] as const;

export type CoreField = (typeof CORE_FIELDS)[number];

// A row with at least one core field missing. Deliberately narrow — this
// crosses to the client, so it carries no PII beyond what the list already
// renders.
export type MissingDetailRow = {
  id: string;
  full_name: string | null;
  instagram_username: string | null;
  missing: string[];
};

export type EnrichOutcome = {
  id: string;
  username: string;
  ok: boolean;
  error?: string;
  // Which fields this row actually gained, for the run summary — a row can
  // succeed on the text fields but fail the photo (or vice-versa).
  updated?: string[];
};
