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
  // 1. Explicit override always wins. This is the ONLY trusted source for
  //    security-sensitive links (invite / password-recovery emails carry
  //    auth tokens) — set NEXT_PUBLIC_SITE_URL in every deploy.
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return normalise(process.env.NEXT_PUBLIC_SITE_URL);
  }

  // 2. Platform-provided URL (Netlify `URL`, Vercel `VERCEL_URL`). Trusted —
  //    set by the host, not attacker-controllable.
  const fromPlatform = process.env.URL || process.env.VERCEL_URL;
  if (fromPlatform) return normalise(fromPlatform);

  // 3. Request headers (x-forwarded-host / host) are attacker-controllable
  //    (host-header injection → poisoned invite/recovery links → account
  //    takeover). NEVER trust them in production. Only fall back to them in
  //    local development, where there's no env var and no attacker.
  if (process.env.NODE_ENV !== "production") {
    try {
      const h = await headers();
      const forwardedHost = h.get("x-forwarded-host") || h.get("host");
      const proto = h.get("x-forwarded-proto") || "http";
      if (forwardedHost) {
        const scheme = forwardedHost.startsWith("localhost") ? "http" : proto;
        return normalise(`${scheme}://${forwardedHost}`);
      }
    } catch {
      /* not in a request context */
    }
    return "http://localhost:3000";
  }

  // 4. Production with no configured URL — fail loud. Returning a wrong host
  //    here would bake bad links into real emails; surface it instead.
  console.error(
    "[site-url] NEXT_PUBLIC_SITE_URL (and platform URL) are unset in production — " +
      "email links cannot be built safely. Set NEXT_PUBLIC_SITE_URL.",
  );
  throw new Error("Site URL is not configured. Contact an administrator.");
}

function normalise(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}
