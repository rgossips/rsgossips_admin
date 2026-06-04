import { headers } from "next/headers";

// Returns the canonical site URL for redirects in transactional emails
// (e.g. Supabase invite + password reset links). Tries the live request
// headers first so we never accidentally bake a localhost URL into a
// production email; falls back to env vars only if the headers aren't
// available (e.g. when called from a background job).
//
// Priority:
//   NEXT_PUBLIC_SITE_URL    explicit override (highest — set this if you
//                           want to force a specific URL)
//   request headers         x-forwarded-host / host (what the browser
//                           actually called — most reliable in practice)
//   URL                     Netlify primary URL env var
//   VERCEL_URL              Vercel deployment URL (host only)
//   localhost fallback      for local dev
export async function getSiteUrl(): Promise<string> {
  // 1. Explicit override always wins
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return normalise(process.env.NEXT_PUBLIC_SITE_URL);
  }

  // 2. Use the actual request host — works in server actions / RSC
  try {
    const h = await headers();
    const forwardedHost = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    if (forwardedHost) {
      // localhost on its own should keep http, everything else https
      const scheme = forwardedHost.startsWith("localhost") ? "http" : proto;
      return normalise(`${scheme}://${forwardedHost}`);
    }
  } catch {
    // Not in a request context — fall through to env vars
  }

  // 3. Platform env vars
  const fromPlatform = process.env.URL || process.env.VERCEL_URL;
  if (fromPlatform) return normalise(fromPlatform);

  // 4. Last resort for local dev outside a request context
  return "http://localhost:3000";
}

function normalise(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}
