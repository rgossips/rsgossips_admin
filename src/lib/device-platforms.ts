// Which platforms a user actually signs in from: the website, the Android
// app, or the iOS app.
//
// There is NO platform column. `device_sessions` carries `user_agent` and a
// cosmetic `device_name`, and the platform has to be derived from the agent
// string. Both mobile apps set their own agent, which is what makes this
// reliable rather than guesswork:
//
//   RGossipsApp/android-34                        -> the Android app
//   RGossipsApp/ios-26.5                          -> the iOS app
//   Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 …)    -> the WEBSITE, on an iPhone
//
// That third case is the one to get right. An iPhone running Safari is a
// web user, not an iOS app user — calling it "iOS" would overstate app
// adoption, and app adoption is the whole reason to show this. Measured
// over 637 sessions: web 559, Android 56, iOS 22; per user, 461 are
// web-only and 38 have ever opened a native app.
//
// Coverage is near-total (492 of 493 creators, 6 of 6 brands have at least
// one session), so an empty result means "never signed in", not "we don't
// know".

import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";

export const PLATFORMS = ["web", "android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  web: "Web",
  android: "Android",
  ios: "iOS",
};

// Spelled out where there is room, because "iOS" alone reads as the device
// rather than the app.
export const PLATFORM_TITLE: Record<Platform, string> = {
  web: "Signed in through the website (any device, including a phone browser)",
  android: "Signed in through the Android app",
  ios: "Signed in through the iOS app",
};

/**
 * One session's platform, or null when the agent string is missing.
 *
 * The app prefix is checked FIRST: the apps embed a WebView whose requests
 * can also carry a browser-looking agent, so a Mozilla test placed first
 * would classify app sessions as web.
 */
export function platformOf(userAgent: string | null | undefined): Platform | null {
  const ua = String(userAgent || "").trim();
  if (!ua) return null;
  if (/^RGossipsApp\/android/i.test(ua)) return "android";
  if (/^RGossipsApp\/ios/i.test(ua)) return "ios";
  // A future RGossipsApp/<something> is an app we don't know yet. Reporting
  // it as web would be wrong, so it is left unclassified rather than
  // guessed at.
  if (/^RGossipsApp\//i.test(ua)) return null;
  return "web";
}

export type PlatformUse = {
  platforms: Platform[];
  /** Most recent activity across every session, for "last seen on". */
  lastActiveAt: string | null;
};

/**
 * Platforms per user, for a KNOWN set of ids.
 *
 * Takes the ids rather than scanning the table because the lists that use
 * this are paginated — 25 rows at a time — and `.in()` on those ids is a
 * single small query that can ride along in the page's existing
 * `Promise.all`. Scanning all sessions on every page view would repeat the
 * mistake the phone-search and category caches exist to fix.
 *
 * Returns an EMPTY map on failure, never a partial one: a half-filled map
 * would render "web only" for someone who also uses the app, which is worse
 * than showing nothing.
 */
export async function platformsForUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, PlatformUse>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, PlatformUse>();
  if (ids.length === 0) return out;

  // Chunked so a large page cannot build a URL past PostgREST's limit.
  const CHUNK = 200;
  const rows: { user_id: string; user_agent: string | null; last_active_at: string | null }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("device_sessions")
      .select("user_id, user_agent, last_active_at")
      .in("user_id", slice);
    if (error) {
      logError("device-platforms", error, { ids: slice.length });
      return new Map();
    }
    rows.push(...(data || []));
  }

  const sets = new Map<string, Set<Platform>>();
  const last = new Map<string, string>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const p = platformOf(r.user_agent);
    if (p) {
      if (!sets.has(r.user_id)) sets.set(r.user_id, new Set());
      sets.get(r.user_id)!.add(p);
    }
    if (r.last_active_at) {
      const prev = last.get(r.user_id);
      if (!prev || r.last_active_at > prev) last.set(r.user_id, r.last_active_at);
    }
  }

  for (const id of ids) {
    const set = sets.get(id);
    if (!set && !last.has(id)) continue;
    out.set(id, {
      // Fixed order, so the badges don't reshuffle between rows.
      platforms: PLATFORMS.filter((p) => set?.has(p)),
      lastActiveAt: last.get(id) ?? null,
    });
  }
  return out;
}
