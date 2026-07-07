// Structured server-side logging + user-facing error mapping.
//
// Two goals:
//  1. Every failure leaves a greppable trace in the Netlify function logs
//     for later analysis — `[scope] message { ...meta }`.
//  2. Raw Supabase/Postgres error text never reaches the browser (it leaks
//     schema internals and is unhelpful). Actions log the raw error and
//     return a friendly, generic string instead.

type Meta = Record<string, unknown>;

// Emit a structured error line. Safe to call from any server context.
export function logError(scope: string, error: unknown, meta?: Meta): void {
  const detail =
    error instanceof Error ? { message: error.message, stack: error.stack } : { value: error };
  // Single line, prefixed so `grep '\[scope\]'` finds every occurrence.
  console.error(`[${scope}]`, JSON.stringify({ ...detail, ...meta }));
}

// Logs the raw DB error and returns a friendly message for the UI. Never
// pass a raw Supabase error straight to `{ error }` — funnel through this.
export function friendlyDbError(
  scope: string,
  error: unknown,
  fallback = "Something went wrong. Please try again.",
  meta?: Meta,
): string {
  logError(scope, error, meta);
  return fallback;
}
