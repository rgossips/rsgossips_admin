// Plain module — NOT "use server". Every export from a "use server" file
// becomes a callable client ref, so types/constants must live here.
// See enrich-actions.ts for the runner.

// Instagram lookups are network-bound (~1-2s each) and Netlify's function
// timeout is short, so the client walks the work-list in small chunks and
// calls the action once per chunk — the same shape bulk-invite uses. Items
// within a chunk run in parallel, so a chunk costs roughly one round trip.
// Keep this small: a chunk that times out loses the whole chunk's API spend.
export const ENRICH_CHUNK_SIZE = 5;

// A row awaiting a photo. Deliberately narrow — this crosses to the client,
// so it carries no PII beyond what the list page already renders.
export type MissingPhotoRow = {
  id: string;
  full_name: string | null;
  instagram_username: string | null;
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
