"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";
import { sanitizeSearchTerm } from "@/lib/validation";
import { rankCandidates, scoreCandidate, type PoolCandidate } from "@/lib/sourcing/pool";
import { genderExcludes, requiredGender } from "@/lib/gender-target";
import { toFulfilmentMode, type FulfilmentMode } from "@/lib/sourcing/stages";

// Pulling creators out of our own database onto a campaign's sourcing list.
//
// The pool is both halves of the creator base: 466 registered profiles and
// ~1,680 pending invitations. An invited creator is a perfectly good person
// to DM — they are in the database precisely because someone already
// decided they were worth approaching — so leaving them out would hide most
// of the pool.

const PAGE = 400;

// Two trailers, two separators, and they are NOT the same: a campaign's
// description uses "\n\n---\n" (the campaign forms write it) while an
// invitation's notes use "\n---\n" (ensure-invitation's buildNotes). Parsing
// one with the other's separator silently yields {} — which on a gender
// brief would read as "no restriction" and put the whole mismatched half of
// the base back in the list.
function parseTrailer(raw: string | null | undefined, sep: string): Record<string, unknown> {
  const s = String(raw || "");
  const at = s.indexOf(sep);
  const json = at !== -1 ? s.slice(at + sep.length) : s.trimStart().startsWith("{") ? s : "";
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function searchCreatorPool(
  campaignId: string,
  opts?: { search?: string; includeInvited?: boolean },
): Promise<{ error?: string; candidates?: PoolCandidate[]; excluded?: number }> {
  const gate = await adminGate();
  if (gate) return { error: gate.error };

  const admin = createAdminClient();

  // target_gender is NOT a column — it lives in the description trailer with
  // the rest of the brief's metadata (see CLAUDE.md, "Description / notes
  // trailer metadata"), so the description has to come back too.
  const { data: campaign } = await admin
    .from("campaigns")
    .select("target_categories, target_cities, target_follower_min, target_follower_max, description")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  const campaignMeta = parseTrailer(campaign?.description, "\n\n---\n");
  const target = {
    categories: campaign?.target_categories ?? null,
    cities: campaign?.target_cities ?? null,
    followerMin: campaign?.target_follower_min ?? null,
    followerMax: campaign?.target_follower_max ?? null,
    gender: Array.isArray(campaignMeta.target_gender) ? (campaignMeta.target_gender as string[]) : null,
  };
  // Null unless the brief names exactly one gender. Nine of 75 campaigns do.
  const needGender = requiredGender(target.gender);

  const term = sanitizeSearchTerm(opts?.search || "");

  // Who is already spoken for on this campaign, so the picker can say so
  // rather than letting an admin pick someone twice.
  const [sourcedRes, appliedRes] = await Promise.all([
    admin.from("campaign_bookings").select("influencer_id, instagram_username").eq("campaign_id", campaignId),
    admin.from("campaign_applications").select("influencer_id").eq("campaign_id", campaignId),
  ]);
  const sourcedIds = new Set((sourcedRes.data || []).map((r) => r.influencer_id).filter(Boolean));
  const sourcedHandles = new Set(
    (sourcedRes.data || []).map((r) => String(r.instagram_username || "").toLowerCase()).filter(Boolean),
  );
  const appliedIds = new Set((appliedRes.data || []).map((r) => r.influencer_id).filter(Boolean));

  const candidates: PoolCandidate[] = [];

  // Registered creators.
  let q = admin
    .from("influencer_profiles")
    .select("influencer_id, full_name, username, instagram_handle, followers_count, categories, location, engagement_rate, status, gender")
    .neq("status", "pending_deletion")
    .limit(PAGE);
  if (term) q = q.or(`full_name.ilike.%${term}%,instagram_handle.ilike.%${term}%,username.ilike.%${term}%`);
  const { data: profiles, error: profErr } = await q;
  if (profErr) {
    logError("sourcing.pool.profiles", profErr, { campaignId });
    return { error: "Could not search creators. Please try again." };
  }
  for (const p of profiles || []) {
    // A female-only brief must not return male creators. Dropped here rather
    // than scored low, and dropped server-side so the mismatched half of the
    // base never crosses to the client at all.
    if (genderExcludes(needGender, p.gender)) continue;
    const handle = p.instagram_handle || p.username || "";
    const { score, reasons } = scoreCandidate(p, target);
    candidates.push({
      influencerId: p.influencer_id,
      invitationId: null,
      name: p.full_name || handle || "—",
      handle,
      followers: p.followers_count ?? null,
      categories: p.categories || [],
      location: p.location ?? null,
      engagementRate: p.engagement_rate ?? null,
      gender: p.gender ?? null,
      registered: true,
      score,
      reasons,
      alreadySourced: sourcedIds.has(p.influencer_id) || sourcedHandles.has(String(handle).toLowerCase()),
      alreadyApplied: appliedIds.has(p.influencer_id),
    });
  }

  // Invited-but-not-registered creators. Their follower count and categories
  // live in the notes trailer, which is where the enrichment writes them.
  if (opts?.includeInvited !== false) {
    let qi = admin
      .from("influencer_invitations")
      .select("id, full_name, instagram_username, notes")
      .eq("status", "pending")
      .limit(PAGE);
    if (term) qi = qi.or(`full_name.ilike.%${term}%,instagram_username.ilike.%${term}%`);
    const { data: invites, error: invErr } = await qi;
    if (invErr) logError("sourcing.pool.invites", invErr, { campaignId });
    for (const i of invites || []) {
      // A malformed trailer just means less to score on.
      const meta = parseTrailer(i.notes, "\n---\n");
      const invGender = typeof meta.gender === "string" ? meta.gender : null;
      // Invitations are the better-populated half for this: 997 of 1000
      // pending ones carry a gender, against 247 of 492 registered profiles.
      if (genderExcludes(needGender, invGender)) continue;
      const handle = i.instagram_username || "";
      const shaped = {
        followers_count: Number(meta.followers) || null,
        categories: Array.isArray(meta.categories) ? (meta.categories as string[]) : [],
        location: typeof meta.city === "string" ? meta.city : null,
        engagement_rate: null,
        gender: invGender,
      };
      const { score, reasons } = scoreCandidate(shaped, target);
      candidates.push({
        influencerId: null,
        invitationId: i.id,
        name: i.full_name || handle || "—",
        handle,
        followers: shaped.followers_count,
        categories: shaped.categories,
        location: shaped.location,
        engagementRate: null,
        gender: invGender,
        registered: false,
        score,
        reasons,
        alreadySourced: sourcedHandles.has(String(handle).toLowerCase()),
        alreadyApplied: false,
      });
    }
  }

  // Anyone already spoken for on this campaign is DROPPED, not just ranked
  // low. This picker answers one question — who else should be on this
  // campaign — and someone who has already applied, or is already on the
  // tracker, is not an answer to it: there is nothing to reach out about.
  // They used to be returned and sunk to the bottom, which meant an admin
  // scrolled past their own existing list to reach the new names.
  //
  // The count comes back so the UI can say they were hidden rather than
  // leaving the admin wondering where a creator they know applied has gone.
  const engaged = candidates.filter((c) => c.alreadySourced || c.alreadyApplied).length;
  const fresh = candidates.filter((c) => !c.alreadySourced && !c.alreadyApplied);

  return { candidates: rankCandidates(fresh), excluded: engaged };
}

// Bring a selection onto the sourcing list. These creators are already in
// the database, so unlike a manual add there is nothing to invite — just a
// booking each, linked to whichever record they came from.
export async function importFromPool(
  campaignId: string,
  picks: { influencerId?: string | null; invitationId?: string | null; handle: string; name?: string | null; followers?: number | null }[],
  fulfilmentMode: FulfilmentMode = "reimburse",
  // Who owns reaching out to this batch. Optional, but without it twenty
  // creators land on the tracker with nobody responsible for them, which is
  // the exact failure the tracker exists to stop.
  assignTo?: string | null,
): Promise<{ error?: string; added?: number; skipped?: number }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!picks?.length) return { added: 0, skipped: 0 };
  if (picks.length > 200) return { error: "Too many at once — pick up to 200." };

  const admin = createAdminClient();
  const rows = picks
    .filter((p) => p.handle)
    .map((p) => ({
      campaign_id: campaignId,
      influencer_id: p.influencerId || null,
      invitation_id: p.invitationId || null,
      instagram_username: String(p.handle).toLowerCase().replace(/^@/, ""),
      creator_name: p.name || null,
      followers_count: Number.isFinite(Number(p.followers)) ? Number(p.followers) : null,
      fulfilment_mode: toFulfilmentMode(fulfilmentMode),
      stage: "shortlisted",
      created_by: actorId,
      // Spread so the keys are absent entirely when nobody was picked —
      // these columns only exist once migration 084 is applied, and sending
      // them as null would fail the insert on a database without them.
      ...(assignTo
        ? {
            assigned_to: assignTo,
            assigned_at: new Date().toISOString(),
            assigned_by: actorId,
            outreach_owner: assignTo,
          }
        : {}),
    }));

  // Filter against what is already on the list, then insert the rest.
  //
  // NOT an upsert: the unique index is on (campaign_id, lower(handle)), an
  // EXPRESSION index, and PostgREST's on_conflict can only name plain
  // columns. The index still backstops a race — hence the per-row fallback
  // below, the same shape bulk-invite uses.
  const { data: existing } = await admin
    .from("campaign_bookings")
    .select("instagram_username")
    .eq("campaign_id", campaignId);
  const taken = new Set((existing || []).map((r) => String(r.instagram_username || "").toLowerCase()));
  const fresh = rows.filter((r) => !taken.has(r.instagram_username));
  const preSkipped = rows.length - fresh.length;
  if (fresh.length === 0) {
    return { added: 0, skipped: preSkipped };
  }

  let added = 0;
  const { data, error } = await admin.from("campaign_bookings").insert(fresh).select("id");
  if (!error) {
    added = data?.length ?? 0;
  } else {
    // One bad row must not lose the other 199. Retry individually and count
    // what lands; a 23505 here is a concurrent admin, not a failure.
    for (const row of fresh) {
      const { error: rowErr } = await admin.from("campaign_bookings").insert(row);
      if (!rowErr) added++;
      else if (String(rowErr.code) !== "23505") {
        logError("sourcing.pool.import.row", rowErr, { campaignId, handle: row.instagram_username });
      }
    }
  }

  // The picker lives on the campaign detail page now, so that path needs
  // refreshing too or the admin sees no change where they just acted.
  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  return { added, skipped: rows.length - added };
}
