// Plain module — shared by the "use server" actions file (which may only
// export async functions) and the page/client components.

// Retention window for the "Delete old errors" button. Fixed server-side:
// the client never supplies a cutoff, so a crafted call can't wipe recent
// (or all) rows.
export const ERROR_RETENTION_DAYS = 30;
