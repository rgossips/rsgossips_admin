"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog, enforceRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { getBalance, hikerConfigured, hikerGet, type HikerBalance } from "@/lib/scouting/hiker";
import { discover, searchCost, type ScoutCandidate, type ScoutMode } from "@/lib/scouting/sources";
import { buildExtras, unwrapUser } from "@/lib/instagram-profile";
import { mergeNotes } from "@/lib/instagram-profile";
import { tierForFollowers, type Tier } from "@/lib/sourcing/tiers";
import { ensureInvitation } from "@/lib/sourcing/ensure-invitation";
import { MAX_TIER_PER_RUN, SEARCH_RATE_LIMIT, TIER_CHUNK, TIER_RATE_LIMIT } from "./scout-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Scouting spends real money on every call, so ALL of these are
// requireAdmin() — not viewerGate. A viewer browsing this page could
// otherwise drain a prepaid balance that the rest of the portal depends on.

export type KnownState = "new" | "invited" | "registered";

export type ScoutRow = ScoutCandidate & {
  /** Whether we already hold this creator, decided against our own DB (free). */
  known: KnownState;
  /** Filled by tierCandidates(). Null until then. */
  followers: number | null;
  follows: number | null;
  posts: number | null;
  bio: string | null;
  email: string | null;
  externalUrl: string | null;
  businessCategory: string | null;
  tier: Tier | null;
  /** True once a tiering lookup has been attempted, success or not. */
  tiered: boolean;
};

export type SearchResponse = {
  error?: string;
  rows?: ScoutRow[];
  requestsSpent?: number;
  note?: string;
  balance?: HikerBalance | null;
};

/** Free, unbilled. Shown on the page so the spend is never invisible. */
export async function getScoutBalance(): Promise<{ error?: string; balance?: HikerBalance }> {
  try {
    await requireAdmin();
  } catch {
    return { error: "Admins only." };
  }
  if (!hikerConfigured()) return { error: "HIKER_API_KEY is not configured on the server." };
  const res = await getBalance();
  return res.ok ? { balance: res.data } : { error: res.error };
}

/**
 * Find candidates, then say which of them we already have.
 *
 * The "already have" pass is the cheap half and it matters twice over: it
 * stops us paying to re-learn a creator who is already in the database, and
 * it answers the question scouting is actually asking — who is NEW to us.
 * Same reasoning as searchCreatorPool, which excludes rather than sinks.
 */
export async function searchCandidates(mode: ScoutMode, query: string): Promise<SearchResponse> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  if (!hikerConfigured()) return { error: "HIKER_API_KEY is not configured on the server." };

  const limited = await enforceRateLimit({
    action: "scout_search",
    actorId,
    limit: SEARCH_RATE_LIMIT,
    windowSec: 3600,
  });
  if (!limited.allowed) return { error: "Too many searches this hour. Try again shortly." };

  const found = await discover(mode, String(query || "").slice(0, 120));
  if (found.error) return { error: found.error, requestsSpent: found.requestsSpent };
  if (found.candidates.length === 0) {
    return { rows: [], requestsSpent: found.requestsSpent, note: found.note };
  }

  const admin = createAdminClient();
  const handles = found.candidates.map((c) => c.username);
  const known = new Map<string, KnownState>();

  // Keyed on the RETURNED row's own handle, never on the query term — an
  // `_` in a handle is a real wildcard inside a PostgREST .or() and would
  // otherwise let one creator answer for another. Same rule as
  // resolveHandles and fetchExistingHandles (see CLAUDE.md).
  try {
    const [profiles, invites] = await Promise.all([
      admin.from("influencer_profiles").select("instagram_handle, username").in("instagram_handle", handles),
      admin.from("influencer_invitations").select("instagram_username").in("instagram_username", handles),
    ]);
    for (const p of profiles.data || []) {
      const h = String(p.instagram_handle || "").toLowerCase();
      if (h) known.set(h, "registered");
    }
    for (const i of invites.data || []) {
      const h = String(i.instagram_username || "").toLowerCase();
      if (h && !known.has(h)) known.set(h, "invited");
    }
  } catch (e) {
    // A failed lookup must NOT read as "new" — that is how a duplicate
    // invitation gets created for somebody who already has an account.
    logError("scouting.known", e, { mode });
    return { error: "Could not check which of these we already have. Try again." };
  }

  const rows: ScoutRow[] = found.candidates.map((c) => ({
    ...c,
    known: known.get(c.username) ?? "new",
    followers: null,
    follows: null,
    posts: null,
    bio: null,
    email: null,
    externalUrl: null,
    businessCategory: null,
    tier: null,
    tiered: false,
  }));

  await auditLog("scout_search", actorId, `${mode}:${String(query).slice(0, 60)} → ${rows.length} candidates`);
  const bal = await getBalance();
  return {
    rows,
    requestsSpent: found.requestsSpent,
    note: found.note,
    balance: bal.ok ? bal.data : null,
  };
}

export type TierResult = {
  username: string;
  ok: boolean;
  followers?: number | null;
  follows?: number | null;
  posts?: number | null;
  bio?: string | null;
  email?: string | null;
  externalUrl?: string | null;
  businessCategory?: string | null;
  isVerified?: boolean | null;
  isPrivate?: boolean | null;
  tier?: Tier | null;
  error?: string;
};

/**
 * Buy the follower count for a chunk of candidates — the only way to tier
 * them, since no discovery endpoint returns one.
 *
 * Uses /v1/user/by/id when we have the pk (the spec says it is the faster
 * one, and search always gives us a pk), falling back to by/username.
 */
export async function tierCandidates(
  items: { username: string; pk: string | null }[],
): Promise<{ error?: string; results?: TierResult[]; balance?: HikerBalance | null }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  if (!hikerConfigured()) return { error: "HIKER_API_KEY is not configured on the server." };
  if (!items?.length) return { results: [] };
  if (items.length > TIER_CHUNK) return { error: `Tier at most ${TIER_CHUNK} at a time.` };

  const limited = await enforceRateLimit({
    action: "scout_tier",
    actorId,
    limit: TIER_RATE_LIMIT,
    windowSec: 3600,
  });
  if (!limited.allowed) {
    return { error: "Hourly lookup limit reached — this protects the prepaid balance." };
  }

  const results = await Promise.all(
    items.map(async (it): Promise<TierResult> => {
      const res = it.pk
        ? await hikerGet<any>("/v1/user/by/id", { id: it.pk })
        : await hikerGet<any>("/v1/user/by/username", { username: it.username });
      if (!res.ok) return { username: it.username, ok: false, error: res.error };

      const u = unwrapUser(res.data) || {};
      const extras = buildExtras(res.data);
      const followers = typeof extras.followers === "number" ? (extras.followers as number) : null;
      return {
        username: it.username,
        ok: true,
        followers,
        follows: typeof extras.follows === "number" ? (extras.follows as number) : null,
        posts: typeof extras.posts === "number" ? (extras.posts as number) : null,
        bio: typeof extras.bio === "string" ? (extras.bio as string) : null,
        email: typeof extras.email === "string" ? (extras.email as string) : null,
        externalUrl: typeof extras.externalUrl === "string" ? (extras.externalUrl as string) : null,
        businessCategory:
          typeof extras.businessCategory === "string" ? (extras.businessCategory as string) : null,
        isVerified: typeof u.is_verified === "boolean" ? u.is_verified : null,
        isPrivate: typeof u.is_private === "boolean" ? u.is_private : null,
        // One owner for the bands — the same function the sourcing add form
        // uses, so a scouted "Micro" means what it means everywhere else.
        // Null rather than "Nano" when we have no count: unknown is not small.
        tier: tierForFollowers(followers),
      };
    }),
  );

  await auditLog("scout_tier", actorId, `${items.length} lookups`);
  const bal = await getBalance();
  return { results, balance: bal.ok ? bal.data : null };
}

/**
 * Keep a scouted creator.
 *
 * ensureInvitation owns the three-way outcome (registered / invited /
 * created) and the notes trailer's admin-curated half. What it does NOT
 * carry is the enrichment we just paid for — followers, bio, email,
 * business category — so this writes those on afterwards via the SAME
 * mergeNotes the enrichment uses. Without that, "Update missing details"
 * would later buy the identical data a second time.
 */
export async function addScoutedCreator(row: {
  username: string;
  fullName: string | null;
  followers: number | null;
  follows: number | null;
  posts: number | null;
  bio: string | null;
  email: string | null;
  externalUrl: string | null;
  businessCategory: string | null;
  isVerified: boolean | null;
  isPrivate: boolean | null;
  profilePicUrl: string | null;
  sourceNote?: string | null;
}): Promise<{ error?: string; outcome?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }

  const handle = String(row.username || "").trim().toLowerCase().replace(/^@/, "");
  if (!handle) return { error: "No handle." };
  // influencer_invitations.full_name is NOT NULL and every one of the 1,735
  // existing rows carries one — a nameless insert is a 23502 that reads as
  // "Could not create the invitation" (see CLAUDE.md). Instagram's display
  // name is usually present; the handle is an honest fallback.
  const fullName = (row.fullName || "").trim() || handle;

  const admin = createAdminClient();
  const ensured = await ensureInvitation(
    admin,
    {
      instagramUsername: handle,
      fullName,
      note: row.sourceNote ? `Scouted on Instagram (${row.sourceNote})` : "Scouted on Instagram",
    },
    actorId,
  );
  if (ensured.outcome === "error") return { error: ensured.error || "Could not add this creator." };

  // Carry the paid enrichment onto the row, whether it was just created or
  // already existed as an invitation. Read-merge-write: the trailer may hold
  // admin-curated keys (city, categories, gender) this knows nothing about.
  if (ensured.invitationId) {
    const extras: Record<string, unknown> = {};
    if (typeof row.followers === "number") extras.followers = row.followers;
    if (typeof row.follows === "number") extras.follows = row.follows;
    if (typeof row.posts === "number") extras.posts = row.posts;
    if (row.bio) extras.bio = row.bio;
    if (row.email) extras.email = row.email;
    if (row.externalUrl) extras.externalUrl = row.externalUrl;
    if (row.businessCategory) extras.businessCategory = row.businessCategory;
    if (typeof row.isVerified === "boolean") extras.verified = row.isVerified;
    if (typeof row.isPrivate === "boolean") extras.isPrivate = row.isPrivate;

    if (Object.keys(extras).length > 0) {
      try {
        const { data: existing } = await admin
          .from("influencer_invitations")
          .select("notes")
          .eq("id", ensured.invitationId)
          .maybeSingle();
        await admin
          .from("influencer_invitations")
          .update({ notes: mergeNotes(existing?.notes ?? null, extras) })
          .eq("id", ensured.invitationId);
      } catch (e) {
        // The creator is saved; losing the enrichment only means paying for
        // it again later, which is not worth failing the add over.
        logError("scouting.add.enrich", e, { handle });
      }
    }
  }

  await auditLog("scout_add", actorId, `@${handle} → ${ensured.outcome}`);
  return { outcome: ensured.outcome };
}

/**
 * Record that a scouting sheet left the building.
 *
 * The rows are already in the browser — they were rendered — so the file is
 * built there and this does NOT round-trip the data back through the server
 * just to hand it straight back. What it does is keep the audit convention
 * the applicant and creator exports follow: these sheets can carry a public
 * email and a bio, and "who pulled a list of 40 creators" is worth being
 * able to answer later.
 */
export async function logScoutExport(count: number, context: string): Promise<{ error?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  await auditLog("scout_export", actorId, `${n} creators · ${String(context || "").slice(0, 80)}`);
  return {};
}

export async function scoutLimits(): Promise<{ chunk: number; maxPerRun: number }> {
  return { chunk: TIER_CHUNK, maxPerRun: MAX_TIER_PER_RUN };
}

export async function searchRequestCost(mode: ScoutMode): Promise<number> {
  return searchCost(mode);
}
