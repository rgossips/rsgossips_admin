// Instagram handle → profile URL. Client- and server-safe.
//
// Handles come from admin input, bulk xlsx imports and scraped data, so they
// can carry a leading "@", whitespace, or junk. Only a syntactically valid
// Instagram username (letters, digits, "." and "_", max 30) produces a URL —
// anything else returns null and the caller renders plain text rather than a
// link to a wrong or malformed profile.
const IG_USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export function normalizeInstagramHandle(handle: string | null | undefined): string | null {
  const h = (handle || "").trim().replace(/^@+/, "");
  return IG_USERNAME.test(h) ? h : null;
}

export function instagramProfileUrl(handle: string | null | undefined): string | null {
  const h = normalizeInstagramHandle(handle);
  return h ? `https://www.instagram.com/${h}/` : null;
}
