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
function extractPhotoUrl(payload: any): string | null {
  const user = payload?.user ?? payload?.data?.user ?? payload?.data ?? payload;
  const candidate =
    user?.profile_pic_url_hd ||
    user?.profile_pic_url ||
    user?.profile_pic_url_signed ||
    user?.hd_profile_pic_url_info?.url ||
    null;
  return typeof candidate === "string" && candidate.startsWith("http") ? candidate : null;
}

async function enrichOne(
  admin: ReturnType<typeof createAdminClient>,
  apiKey: string,
  row: { id: string; instagram_username: string },
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

    const photoUrl = extractPhotoUrl(await res.json());
    if (!photoUrl) return fail("No profile photo in the API response");

    // Re-host: the CDN URL above is signed and expires.
    const img = await fetchWithTimeout(photoUrl);
    if (!img.ok) return fail(`Photo download failed (${img.status})`);

    const contentType = img.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return fail("Downloaded file was not an image");

    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.byteLength === 0) return fail("Downloaded photo was empty");
    if (bytes.byteLength > MAX_PHOTO_BYTES) return fail("Photo larger than 5MB");

    const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
    // Server-generated path — never trust a remote filename.
    const path = `photos/enriched/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("influencer-photos")
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) {
      logError("influencers.enrich.upload", upErr, { username });
      return fail("Storage upload failed");
    }

    const { data: pub } = admin.storage.from("influencer-photos").getPublicUrl(path);

    // Only profile_photo_url — never touch `notes`. The RS_Gossips
    // enrichment script packs keys (followers, bio, …) into that trailer
    // and a write here would race/wipe them.
    const { error: updErr } = await admin
      .from("influencer_invitations")
      .update({ profile_photo_url: pub.publicUrl })
      .eq("id", row.id);
    if (updErr) {
      logError("influencers.enrich.update", updErr, { username });
      return fail("DB update failed");
    }

    return { id: row.id, username, ok: true };
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
export async function enrichInvitationPhotos(
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
  const { data: rows, error } = await admin
    .from("influencer_invitations")
    .select("id, instagram_username, profile_photo_url")
    .in("id", ids);
  if (error) {
    return { error: friendlyDbError("influencers.enrichChunk", error, "Lookup failed") };
  }

  const targets = (rows || []).filter(
    (r) => (r.instagram_username || "").trim() && !(r.profile_photo_url || "").trim(),
  );

  const results = await Promise.all(
    targets.map((r) =>
      enrichOne(admin, apiKey, { id: r.id, instagram_username: r.instagram_username as string }),
    ),
  );

  if (results.some((r) => r.ok)) revalidatePath("/dashboard/influencers");
  return { results };
}
