"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin } from "@/lib/require-super-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { ENRICH_CHUNK_SIZE, type MissingPhotoRow, type EnrichOutcome } from "./enrich-constants";

// Backfills profile photos on PENDING influencer_invitations from HikerAPI.
// Scoped to invitations only: a registered creator with no photo may have
// chosen that, and overwriting would fight their intent.
//
// Replaces the one-off scripts/enrich_invitations.js (Apify) in RS_Gossips
// with an in-portal flow. Same core constraint as that script: Instagram CDN
// URLs are signed and EXPIRE, so the photo must be downloaded and re-hosted
// in our own bucket — storing the CDN URL directly yields dead images later.

const HIKER_BASE = "https://api.hikerapi.com";
const MAX_SCAN_ROWS = 2000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

// Each call costs HikerAPI credits, so cap how fast one admin can burn them.
// One call == one chunk == ENRICH_CHUNK_SIZE creators.
//
// Sized against the real backlog: ~838 invitations => ~168 chunks for a full
// pass. 400 leaves room for a full run plus a retry sweep over the failures
// (private accounts, renamed handles) inside the same hour, while still
// capping a runaway at ~2000 lookups/hr.
const ENRICH_LIMIT_PER_HOUR = 400;

// Lists pending invitations with no profile photo. Read-only + admin-gated:
// instagram_username + full_name are PII, so this must never be reachable
// by a viewer or an unauthenticated session.
export async function scanMissingPhotos(): Promise<{
  rows?: MissingPhotoRow[];
  truncated?: boolean;
  error?: string;
}> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("influencer_invitations")
    .select("id, full_name, instagram_username")
    .eq("status", "pending")
    // Rows land here with either NULL or "" depending on which form/import
    // created them, so both count as missing. No user input in this filter.
    .or("profile_photo_url.is.null,profile_photo_url.eq.")
    .order("created_at", { ascending: false })
    .limit(MAX_SCAN_ROWS + 1);

  if (error) {
    return { error: friendlyDbError("influencers.scanMissingPhotos", error, "Scan failed") };
  }

  // Only rows we can actually look up — no handle means nothing to query.
  const usable = (data || []).filter((r) => (r.instagram_username || "").trim());
  const truncated = usable.length > MAX_SCAN_ROWS;
  return { rows: usable.slice(0, MAX_SCAN_ROWS), truncated };
}

// Bounded fetch — a hung upstream would otherwise sit until the platform
// kills the whole function and we'd lose the chunk's already-spent credits.
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// HikerAPI has shipped several response shapes (v1 returns the user object
// flat, v2 nests it under `user`), and the HD variant isn't always present.
// Probe rather than assume, so a shape change degrades to "not found"
// instead of writing `undefined` over a photo.
function unwrapUser(payload: any): any {
  return payload?.user ?? payload?.data?.user ?? payload?.data ?? payload;
}

function extractPhotoUrl(payload: any): string | null {
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

// Maps a HikerAPI user onto the notes-trailer keys ALREADY in use (written
// by the old RS_Gossips Apify script, read by the featured-creators /
// creator-stories pickers). Key names and value shapes must match it exactly:
// followers/follows/posts are numbers, bio a trimmed string, verified a
// boolean, businessCategory a string.
//
// A key is emitted ONLY when the API actually returned something usable —
// absent fields must not clobber a populated value with 0/""/false. `verified`
// and `isPrivate` are the exceptions: false is a real answer, not a blank.
//
// Deliberately NOT written: city, categories, gender, languages. Those are
// admin-curated (city is a canonical comma-joined scalar the RS_Gossips
// brand-campaigns matcher depends on) and a scraped value would corrupt them.
function buildExtras(payload: any): Record<string, unknown> {
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

// Preserves the free-text half of `notes` and MERGES into the JSON trailer —
// never rebuilds it. The trailer holds admin-curated keys this action knows
// nothing about (city, categories, gender, languages, tags); a wholesale
// rewrite would wipe them. Mirrors mergeNotes() in the Apify script.
function mergeNotes(existing: string | null, extras: Record<string, unknown>): string {
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

// Downloads and re-hosts the photo. Returns null (never throws) so a photo
// problem can't cost us the text fields we already have in hand.
async function rehostPhoto(
  admin: ReturnType<typeof createAdminClient>,
  photoUrl: string,
  username: string,
): Promise<string | null> {
  try {
    const img = await fetchWithTimeout(photoUrl);
    if (!img.ok) return null;

    const contentType = img.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return null;

    const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
    // Server-generated path — never trust a remote filename.
    const path = `photos/enriched/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await admin.storage
      .from("influencer-photos")
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      logError("influencers.enrich.upload", error, { username });
      return null;
    }
    return admin.storage.from("influencer-photos").getPublicUrl(path).data.publicUrl;
  } catch (e) {
    logError("influencers.enrich.photo", e, { username });
    return null;
  }
}

async function enrichOne(
  admin: ReturnType<typeof createAdminClient>,
  apiKey: string,
  row: { id: string; instagram_username: string; full_name: string | null; notes: string | null; profile_photo_url: string | null },
): Promise<EnrichOutcome> {
  const username = row.instagram_username.trim().replace(/^@+/, "");
  const fail = (error: string): EnrichOutcome => ({ id: row.id, username, ok: false, error });

  try {
    const res = await fetchWithTimeout(
      `${HIKER_BASE}/v1/user/by/username?username=${encodeURIComponent(username)}`,
      { headers: { "x-access-key": apiKey, accept: "application/json" } },
    );

    if (res.status === 404) return fail("No such Instagram account");
    if (res.status === 401 || res.status === 403) return fail("HikerAPI rejected the key");
    if (res.status === 429) return fail("HikerAPI rate limit — try again shortly");
    if (!res.ok) return fail(`HikerAPI error ${res.status}`);

    const payload = await res.json();
    const user = unwrapUser(payload) || {};

    const updates: Record<string, unknown> = {};
    const updated: string[] = [];

    // Text fields from the same response the photo comes from — free.
    const extras = buildExtras(payload);
    if (Object.keys(extras).length > 0) {
      updates.notes = mergeNotes(row.notes, extras);
      updated.push(...Object.keys(extras));
    }

    // Only fill a blank name — an admin may have deliberately set a display
    // name that differs from the Instagram one.
    const apiName = typeof user.full_name === "string" ? user.full_name.trim() : "";
    if (apiName && !(row.full_name || "").trim()) {
      updates.full_name = apiName;
      updated.push("full_name");
    }

    // Photo last: it's the only step that can fail on its own, and doing it
    // after the field mapping means a dead CDN link still leaves the row
    // better off than it started.
    let photoProblem = "";
    if (!(row.profile_photo_url || "").trim()) {
      const photoUrl = extractPhotoUrl(payload);
      if (!photoUrl) {
        photoProblem = "no photo in API response";
      } else {
        const hosted = await rehostPhoto(admin, photoUrl, username);
        if (hosted) {
          updates.profile_photo_url = hosted;
          updated.push("photo");
        } else {
          photoProblem = "photo download/upload failed";
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail(photoProblem || "API returned nothing usable");
    }

    const { error: updErr } = await admin
      .from("influencer_invitations")
      .update(updates)
      .eq("id", row.id);
    if (updErr) {
      logError("influencers.enrich.update", updErr, { username });
      return fail("DB update failed");
    }

    // Partial success is still success — surface what was missed.
    return {
      id: row.id,
      username,
      ok: true,
      updated,
      error: photoProblem || undefined,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    logError("influencers.enrich", e, { username });
    return fail(aborted ? "Timed out" : e instanceof Error ? e.message : "Unexpected error");
  }
}

// Enriches one client-sent chunk. Ids are re-read from the DB rather than
// trusting client-sent usernames, and each row is re-checked for an empty
// photo so a concurrent admin's work isn't overwritten (and its credits
// aren't spent twice).
export async function enrichInvitations(
  ids: string[],
): Promise<{ results?: EnrichOutcome[]; error?: string }> {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const apiKey = process.env.HIKER_API_KEY;
  if (!apiKey) {
    return { error: "HIKER_API_KEY is not configured on the server." };
  }

  if (!Array.isArray(ids) || ids.length === 0) return { results: [] };
  if (ids.length > ENRICH_CHUNK_SIZE) {
    return { error: `Too many rows in one call (max ${ENRICH_CHUNK_SIZE}).` };
  }

  const limit = await enforceRateLimit({
    action: "enrich_photos",
    actorId: adminId,
    limit: ENRICH_LIMIT_PER_HOUR,
    windowSec: 3600,
  });
  if (!limit.allowed) {
    return { error: "Hourly enrichment limit reached. Try again later." };
  }

  const admin = createAdminClient();
  // Re-read server-side rather than trusting client-sent usernames, and pull
  // notes/full_name so the merge is against current DB state, not a stale
  // copy the client scanned minutes ago.
  const { data: rows, error } = await admin
    .from("influencer_invitations")
    .select("id, instagram_username, profile_photo_url, full_name, notes")
    .in("id", ids);
  if (error) {
    return { error: friendlyDbError("influencers.enrichChunk", error, "Lookup failed") };
  }

  // Nothing to look up without a handle. A row that already has a photo is
  // still processed — it may be missing the text fields (the old Apify pass
  // left ~18 such rows), and this call's response covers both anyway.
  const targets = (rows || []).filter((r) => (r.instagram_username || "").trim());

  const results = await Promise.all(
    targets.map((r) =>
      enrichOne(admin, apiKey, {
        id: r.id,
        instagram_username: r.instagram_username as string,
        full_name: r.full_name,
        notes: r.notes,
        profile_photo_url: r.profile_photo_url,
      }),
    ),
  );

  if (results.some((r) => r.ok)) revalidatePath("/dashboard/influencers");
  return { results };
}
