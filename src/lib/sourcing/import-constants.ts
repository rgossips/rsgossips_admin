// Bulk-import tuning. Plain module, NOT "use server": every export from a
// "use server" file becomes a callable client ref at import time, so a
// constant declared beside the action would be replaced by a function —
// the same split as enrich-constants.ts.

// Rows per server call. The client slices the parsed workbook and calls
// once per chunk, so a 300-row sheet stays well inside the Netlify function
// timeout no matter how many creators are new (each of those is an
// invitation insert on top of the booking).
export const IMPORT_CHUNK_SIZE = 100;

// Hard ceiling the server enforces, independent of what the client sends.
export const MAX_ROWS_PER_CALL = 150;

// Upper bound on one workbook. The xlsx parse is synchronous on the main
// thread, so a huge file freezes the tab before chunking can help.
export const MAX_IMPORT_ROWS = 2000;
