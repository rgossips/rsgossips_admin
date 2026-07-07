// Shared input-validation + sanitization helpers for server actions.
// Server-safe (no "use server") so any action file can import them.

// Reasonable email shape check — not RFC-perfect, just enough to reject
// obviously malformed input before it hits the DB or the mailer.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(v: string | null | undefined): boolean {
  return !!v && EMAIL_RE.test(v.trim());
}

// http(s) URL only — blocks javascript:, data:, ftp:, etc. that could be
// stored and later rendered into an href/src.
export function isHttpUrl(v: string | null | undefined): boolean {
  if (!v) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Instagram handle: letters, numbers, dot, underscore, 1–30 chars.
const IG_RE = /^[A-Za-z0-9._]{1,30}$/;
export function isInstagramHandle(v: string | null | undefined): boolean {
  return !!v && IG_RE.test(v.trim());
}

export function isValidDate(v: string | null | undefined): boolean {
  if (!v) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

// Truncate free text to a column-safe length. Returns the trimmed,
// capped string.
export function clampLen(v: string | null | undefined, max: number): string {
  const s = (v || "").toString().trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Parse an int, returning `fallback` on NaN and clamping to [min, max].
export function toIntOr(
  raw: unknown,
  fallback: number,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {},
): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Neutralizes PostgREST filter-injection. Supabase `.or("col.ilike.%q%")`
// strings are built by hand across the app; a `search` value containing
// the reserved chars , . : ( ) " \ can inject extra OR predicates against
// the service-role client. We strip every reserved char plus the LIKE
// wildcards % and _ so the term can only ever be a literal substring.
// Also length-capped to keep the query string bounded.
export function sanitizeSearchTerm(v: string | null | undefined, max = 100): string {
  return (v || "")
    .toString()
    .replace(/[,.:()"'\\%_*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
