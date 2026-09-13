// Structured server-side logging + user-facing error mapping.
//
// Two goals:
//  1. Every failure leaves a greppable trace in the Netlify function logs
//     for later analysis — `[scope] message { ...meta }`.
//  2. Raw Supabase/Postgres error text never reaches the browser (it leaks
//     schema internals and is unhelpful). Actions log the raw error and
//     return a friendly, generic string instead.

type Meta = Record<string, unknown>;

// Supabase/PostgREST errors are PLAIN OBJECTS ({ message, code, details,
// hint }), not Error instances — `String(error)` on one is "[object Object]",
// which is what every admin row in error_logs said before this existed.
function describeError(error: unknown): { message: string; stack: string | null; extra: Meta } {
  if (error instanceof Error) return { message: error.message, stack: error.stack || null, extra: {} };
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const extra: Meta = {};
    for (const k of ["code", "details", "hint", "status"]) {
      if (e[k] !== undefined && e[k] !== null && e[k] !== "") extra[k] = e[k];
    }
    const message = typeof e.message === "string" && e.message ? e.message : JSON.stringify(error).slice(0, 500);
    return { message, stack: null, extra };
  }
  return { message: String(error), stack: null, extra: {} };
}

// Which deployment wrote the row. Local `next dev` shares the production
// Supabase project, so without this a developer's flaky connection is
// indistinguishable from a production incident on the Errors page.
// Netlify sets CONTEXT (production | deploy-preview | branch-deploy).
function runtimeEnv(): string {
  return process.env.CONTEXT || (process.env.NODE_ENV === "production" ? "production" : "local");
}

// Emit a structured error line. Safe to call from any server context.
export function logError(scope: string, error: unknown, meta?: Meta): void {
  const described = describeError(error);
  const detail = { message: described.message, stack: described.stack, ...described.extra };
  // Single line, prefixed so `grep '\[scope\]'` finds every occurrence.
  console.error(`[${scope}]`, JSON.stringify({ ...detail, ...meta }));

  // Also persist to public.error_logs so the admin Errors page shows these
  // alongside edge-function and client failures. Fire-and-forget and fully
  // wrapped: an action that already failed must not fail twice because
  // recording the failure broke too. The import is lazy so this module stays
  // cheap for callers that never hit an error.
  try {
    void (async () => {
      try {
        const { createAdminClient } = await import("@/utils/supabase/admin");
        await createAdminClient().from("error_logs").insert({
          source: "admin",
          // scope reads "payout.update" — the leading segment is the area.
          area: String(scope).split(".")[0] || "admin",
          event: scope,
          severity: "error",
          message: described.message.slice(0, 2000),
          stack: described.stack ? described.stack.slice(0, 2000) : null,
          context: { ...described.extra, ...(meta || {}), env: runtimeEnv() } as Record<string, unknown>,
        });
      } catch {
        /* table absent (migration not applied yet) or insert failed */
      }
    })();
  } catch {
    /* never throw from the logger */
  }
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
