// Returns the canonical site URL for redirects in transactional emails
// (e.g. Supabase invite + password reset links). Picks the most specific
// value available so the link always points at the right deployment:
//
//   NEXT_PUBLIC_SITE_URL    explicit override (preferred — set this)
//   URL                     Netlify primary URL
//   VERCEL_URL              Vercel deployment URL (host only, no scheme)
//   localhost fallback      for local dev
export function getSiteUrl(): string {
  let url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";

  // Vercel returns a bare host — prepend the scheme
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  // Strip trailing slash so we can always append a path
  return url.replace(/\/+$/, "");
}
