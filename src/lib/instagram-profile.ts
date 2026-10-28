// Reading a HikerAPI user payload, in one place.
//
// WHY THIS IS SHARED. Two features now turn an Instagram profile into our
// own notes-trailer keys: the "Update missing details" enrichment on the
// influencer list, and Instagram scouting. CLAUDE.md already records that
// these key names are load-bearing — `followers`/`follows`/`posts`/`bio`/
// `verified`/`businessCategory` must match what the older Apify script
// wrote, because the featured-creators and creator-stories pickers read
// `meta.followers`. Two copies of that mapping is exactly how one of them
// quietly starts writing `followerCount` and those pickers go blank.
//
// Extracted verbatim from enrich-actions.ts, which now imports it. It is a
// plain module rather than part of that file because a `"use server"` file
// may only export async functions.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** HikerAPI has shipped more than one envelope; unwrap all of them. */
export function unwrapUser(payload: any): any {
  return payload?.user ?? payload?.data?.user ?? payload?.data ?? payload;
}

export function extractPhotoUrl(payload: any): string | null {
  const user = unwrapUser(payload);
  // _hd is genuinely absent for many real creators (null on @uv_techh but
  // present on @instagram), so the sd fallback is load-bearing, not padding.
  const candidate =
    user?.profile_pic_url_hd ||
    user?.profile_pic_url ||
    user?.profile_pic_url_signed ||
    user?.hd_profile_pic_url_info?.url ||
    null;
  return typeof candidate === "string" && candidate.startsWith("http") ? candidate : null;
}

/**
 * The notes-trailer keys a profile payload can fill.
 *
 * A field is written ONLY when the API returned something usable — an absent
 * field must never clobber a populated value with `0` or `""`. `verified`
 * and `isPrivate` are the deliberate exceptions: `false` is a real answer.
 */
export function buildExtras(payload: any): Record<string, unknown> {
  const u = unwrapUser(payload) || {};
  const extras: Record<string, unknown> = {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (typeof u.follower_count === "number") extras.followers = u.follower_count;
  if (typeof u.following_count === "number") extras.follows = u.following_count;
  if (typeof u.media_count === "number") extras.posts = u.media_count;
  if (typeof u.is_verified === "boolean") extras.verified = u.is_verified;
  if (typeof u.is_private === "boolean") extras.isPrivate = u.is_private;

  const bio = str(u.biography);
  if (bio) extras.bio = bio;

  // Apify wrote businessCategoryName here; HikerAPI splits the same idea
  // across three fields and often only populates `category`.
  const category = str(u.business_category_name) || str(u.category_name) || str(u.category);
  if (category) extras.businessCategory = category;

  const email = str(u.public_email);
  if (email) extras.email = email;

  const externalUrl = str(u.external_url);
  if (externalUrl) extras.externalUrl = externalUrl;

  const phone = [str(u.public_phone_country_code), str(u.public_phone_number)].filter(Boolean).join(" ");
  if (phone) extras.phone = phone;

  return extras;
}

/**
 * Preserves the free-text half of `notes` and MERGES into the JSON trailer —
 * never rebuilds it. The trailer holds admin-curated keys this mapping knows
 * nothing about (city, categories, gender, languages, tags); a wholesale
 * rewrite would wipe them. Mirrors mergeNotes() in the Apify script.
 */
export function mergeNotes(existing: string | null, extras: Record<string, unknown>): string {
  let text = "";
  let meta: Record<string, unknown> = {};
  if (existing) {
    const sep = existing.indexOf("\n---\n");
    if (sep >= 0) {
      text = existing.slice(0, sep);
      try { meta = JSON.parse(existing.slice(sep + 5)) || {}; } catch { /* keep {} */ }
    } else if (existing.trim().startsWith("{")) {
      try { meta = JSON.parse(existing) || {}; } catch { text = existing; }
    } else {
      text = existing;
    }
  }
  const merged = { ...meta, ...extras };
  return text ? `${text}\n---\n${JSON.stringify(merged)}` : JSON.stringify(merged);
}
