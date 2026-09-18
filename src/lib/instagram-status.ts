// A creator's Instagram connection health, derived from the columns the
// consumer app's refresh-instagram writes. Mirrors rgossips_web
// src/lib/instagramToken.js (isInstagramTokenExpired /
// isInstagramInsightsNotGranted) so the admin sees what the creator's banner
// shows.
//
// Server-only input: the raw access token is read to know whether one exists,
// and must never be passed on to a client component — hand over the derived
// status instead.

export type IgStatus = "authorized" | "insights_denied" | "reconnect" | "not_connected";

export function instagramStatus(p: {
  instagram_access_token?: string | null;
  instagram_token_expires_at?: string | null;
  instagram_token_invalid_at?: string | null;
  instagram_insights_denied_at?: string | null;
}): IgStatus {
  if (!p.instagram_access_token) return "not_connected";
  if (p.instagram_token_invalid_at) return "reconnect";
  const expires = p.instagram_token_expires_at ? Date.parse(p.instagram_token_expires_at) : NaN;
  if (Number.isFinite(expires) && expires < Date.now()) return "reconnect";
  if (p.instagram_insights_denied_at) return "insights_denied";
  return "authorized";
}
