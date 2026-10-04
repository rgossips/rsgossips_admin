"use server";

import { requireAdmin } from "@/lib/require-super-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { normalizeHandle } from "@/lib/sourcing/ensure-invitation";
import { createAdminClient } from "@/utils/supabase/admin";

// Look up one Instagram handle while an admin is filling in the add form.
//
// Typing a creator's name, follower count and category by hand off their
// profile is the slowest part of sourcing and the easiest to get wrong. One
// call fills all of it.
//
// EVERY CALL SPENDS HIKERAPI CREDITS. Hence: admin-gated, rate-limited per
// admin, and only ever fired by an explicit button press — never on blur,
// never on a debounce as somebody types a handle character by character,
// which would buy a lookup for "d", "de", "dee"…
//
// It also reports whether we already know this creator, because that is the
// other thing the admin needs before adding them and it costs nothing: the
// database is checked first and the paid call only happens afterwards.

const HIKER_BASE = "https://api.hikerapi.com";
const TIMEOUT_MS = 12_000;

export type HandleLookup = {
  handle: string;
  // What our own database already knows.
  known: "registered" | "invited" | "new";
  knownName?: string | null;
  /** Where the details came from. "db" means no credit was spent. */
  source?: "db" | "instagram";
  // What Instagram says. Absent when the lookup was skipped or failed.
  fetched?: {
    fullName: string | null;
    followers: number | null;
    following: number | null;
    posts: number | null;
    verified: boolean | null;
    isPrivate: boolean | null;
    category: string | null;
    bio: string | null;
    email: string | null;
    profilePhotoUrl: string | null;
  };
  error?: string;
};

// The invitation notes trailer: optional prose, then a "---" line, then
// JSON. Same contract the invite form and the photo enrichment both use.
const TRAILER_SEPARATOR = "\n---\n";

function parseTrailer(notes: unknown): Record<string, unknown> {
  const raw = String(notes || "");
  const at = raw.indexOf(TRAILER_SEPARATOR);
  const json =
    at !== -1 ? raw.slice(at + TRAILER_SEPARATOR.length) : raw.trimStart().startsWith("{") ? raw : "";
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function lookupHandle(rawHandle: string): Promise<{ error?: string; result?: HandleLookup }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const handle = normalizeHandle(rawHandle);
  if (!handle) return { error: "Enter an Instagram handle." };

  const admin = createAdminClient();

  // Free half first. If they are already a registered creator we have
  // better data than Instagram will give us, and no reason to pay.
  const { data: profile } = await admin
    .from("influencer_profiles")
    .select("influencer_id, full_name, followers_count, categories, location, instagram_handle")
    .ilike("instagram_handle", handle.replace(/[\\%_]/g, (m) => `\\${m}`))
    .limit(1);
  if (profile?.length) {
    const p = profile[0];
    return {
      result: {
        handle,
        known: "registered",
        knownName: p.full_name,
        source: "db",
        fetched: {
          fullName: p.full_name,
          followers: p.followers_count ?? null,
          following: null,
          posts: null,
          verified: null,
          isPrivate: null,
          category: Array.isArray(p.categories) ? p.categories[0] ?? null : null,
          bio: null,
          email: null,
          profilePhotoUrl: null,
        },
      },
    };
  }

  const { data: invite } = await admin
    .from("influencer_invitations")
    .select("id, full_name, notes, profile_photo_url")
    .ilike("instagram_username", handle.replace(/[\\%_]/g, (m) => `\\${m}`))
    .limit(1);

  // An invited creator usually already carries everything this form needs.
  // The photo enrichment writes followers, posts, verified and the rest into
  // the notes trailer, and all but ~170 of the 1,680 pending invitations
  // have them. Paying HikerAPI for data we already hold is exactly the waste
  // to avoid, so the API is reached only when the trailer cannot answer.
  if (invite?.length) {
    const meta = parseTrailer(invite[0].notes);
    const followers = num(meta.followers);
    if (followers !== null) {
      return {
        result: {
          handle,
          known: "invited",
          knownName: invite[0].full_name,
          source: "db",
          fetched: {
            fullName: invite[0].full_name ?? null,
            followers,
            following: num(meta.follows),
            posts: num(meta.posts),
            verified: typeof meta.verified === "boolean" ? meta.verified : null,
            isPrivate: typeof meta.isPrivate === "boolean" ? meta.isPrivate : null,
            category: str(meta.businessCategory),
            bio: str(meta.bio),
            email: str(meta.email),
            profilePhotoUrl: invite[0].profile_photo_url ?? null,
          },
        },
      };
    }
  }

  const apiKey = process.env.HIKER_API_KEY;
  if (!apiKey) {
    return {
      result: {
        handle,
        known: invite?.length ? "invited" : "new",
        knownName: invite?.[0]?.full_name ?? null,
        error: "HIKER_API_KEY isn't configured, so details can't be fetched.",
      },
    };
  }

  // 120 lookups per admin per hour: generous for a working session, low
  // enough that a stuck loop cannot drain the balance.
  const limit = await enforceRateLimit({ action: "sourcing_lookup", actorId, limit: 120, windowSec: 3600 });
  if (!limit.allowed) {
    return {
      result: {
        handle,
        known: invite?.length ? "invited" : "new",
        knownName: invite?.[0]?.full_name ?? null,
        error: "You've used this hour's lookups. The details can still be typed in.",
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${HIKER_BASE}/v1/user/by/username?username=${encodeURIComponent(handle)}`, {
      headers: { "x-access-key": apiKey, accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 402) {
      return {
        result: { handle, known: invite?.length ? "invited" : "new", knownName: invite?.[0]?.full_name ?? null, error: "HikerAPI is out of credits." },
      };
    }
    if (res.status === 404) {
      return { result: { handle, known: invite?.length ? "invited" : "new", knownName: invite?.[0]?.full_name ?? null, error: `No Instagram account called @${handle}.` } };
    }
    if (!res.ok) {
      return { result: { handle, known: invite?.length ? "invited" : "new", knownName: invite?.[0]?.full_name ?? null, error: `Lookup failed (HTTP ${res.status}).` } };
    }

    // HikerAPI has shipped more than one shape; take whichever is present
    // rather than writing undefined into the form.
    const payload = await res.json();
    const u = payload?.user || payload?.data || payload || {};

    return {
      result: {
        handle,
        known: invite?.length ? "invited" : "new",
        knownName: invite?.[0]?.full_name ?? null,
        source: "instagram",
        fetched: {
          fullName: str(u.full_name),
          followers: num(u.follower_count),
          following: num(u.following_count),
          posts: num(u.media_count),
          verified: typeof u.is_verified === "boolean" ? u.is_verified : null,
          isPrivate: typeof u.is_private === "boolean" ? u.is_private : null,
          category: str(u.business_category_name) || str(u.category_name) || str(u.category),
          bio: str(u.biography),
          email: str(u.public_email),
          profilePhotoUrl: str(u.profile_pic_url_hd) || str(u.profile_pic_url),
        },
      },
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    logError("sourcing.lookup", e, { handle });
    return {
      result: {
        handle,
        known: invite?.length ? "invited" : "new",
        knownName: invite?.[0]?.full_name ?? null,
        error: aborted ? "Instagram didn't answer in time." : "Lookup failed.",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
