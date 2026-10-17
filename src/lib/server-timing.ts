// Where a request's time actually goes.
//
// Measured before writing this, against the deployed site:
//
//   static asset (CDN, no function)      ~290ms server time
//   /login        (SSR, no Supabase)     ~380ms
//   /dashboard    (307, middleware only) ~680ms
//   /api/widget/stats (auth + queries)  ~1450ms
//
// and, from a machine on the same continent, a warm Supabase round trip is
// ~90-100ms while a cold one is 240-600ms. So the queries are not the
// problem — the number of sequential round trips is, and the ~300ms gap
// between /login and a bare /dashboard redirect is middleware's
// `getUser()`, paid on EVERY request including every filter click.
//
// This module makes that visible per request instead of inferred.
//
// WHERE IT CAN AND CANNOT GO. Middleware and Route Handlers own a Response
// and can set headers. A Server Component cannot: `headers()` is read-only
// (Next 16 docs, api-reference/functions/headers — "you cannot set or
// delete the outgoing request headers"). So pages get `logTimings`, which
// prints one line per render into the Netlify function log, and everything
// that owns a Response gets a real `Server-Timing` header that DevTools
// renders as a breakdown under the request's Timing tab.

export type Span = { name: string; ms: number };

export class Timer {
  private marks: Span[] = [];
  private readonly started = performance.now();

  /** Time an awaited operation and record it under `name`. */
  async span<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.marks.push({ name, ms: performance.now() - t0 });
    }
  }

  /** Record a duration measured elsewhere. */
  add(name: string, ms: number): void {
    this.marks.push({ name, ms });
  }

  get totalMs(): number {
    return performance.now() - this.started;
  }

  get spans(): readonly Span[] {
    return this.marks;
  }

  /**
   * A `Server-Timing` value.
   *
   * Names are sanitised to the token characters the grammar allows —
   * anything else makes the browser drop the whole header silently, which
   * would be a diagnostic that fails without saying so.
   */
  toHeader(): string {
    const parts = this.marks.map(
      (m) => `${m.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)};dur=${m.ms.toFixed(1)}`,
    );
    parts.push(`total;dur=${this.totalMs.toFixed(1)}`);
    return parts.join(", ");
  }

  /** "dashboard 712ms = auth 301 + role 98 + rows 210" */
  toLine(label: string): string {
    const body = this.marks.map((m) => `${m.name} ${Math.round(m.ms)}`).join(" + ");
    return `[timing] ${label} ${Math.round(this.totalMs)}ms${body ? ` = ${body}` : ""}`;
  }
}

/**
 * Attach the breakdown to a response.
 *
 * Server-Timing is only exposed to page JavaScript on same-origin requests,
 * but DevTools shows it regardless — and reading it there is the point.
 */
export function withTiming<T extends { headers: Headers }>(res: T, timer: Timer): T {
  res.headers.set("Server-Timing", timer.toHeader());
  return res;
}

/**
 * For pages, which cannot set headers.
 *
 * One line per render. Deliberately console.log and not logError: this is
 * not a failure, and routing it through the error table would both pollute
 * the triage queue and add a database write to the very request it is
 * trying to measure.
 */
export function logTimings(label: string, timer: Timer): void {
  console.log(timer.toLine(label));
}
