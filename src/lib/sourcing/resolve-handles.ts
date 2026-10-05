// Resolving a batch of Instagram handles against the creator database.
//
// ensure-invitation.ts answers the same question for ONE handle and costs
// three round trips to do it. At 200 rows that is 600 trips inside a
// serverless function with a short timeout, so a bulk import needs the
// batched form: four queries total, whatever the row count.
//
// The outcomes are the same three ensure-invitation uses, plus the one only
// a campaign can have:
//
//   sourced    — already on THIS campaign's sourcing list. Nothing to do.
//   registered — has an RGossips account. Link to it.
//   invited    — a pending invitation exists. Link to it. The COMMON case
//                on a hand-built sheet, not an error.
//   new        — we have never heard of them. Importing them creates an
//                invitation, which is the admin's call to make.
//
// A FAILED lookup is reported as a failure, never as "new" — reading a dead
// query as "not found" would create duplicate invitations for creators who
// already have accounts, which is the one mistake here that cannot be
// undone by deleting a booking.
//
// One load-bearing subtlety: the lookups below are `ilike` inside an `or()`
// filter, and PostgREST does NOT honour escapeLike's backslashes there —
// verified against the live database, where an escaped "%" still returned
// every row. So "_" in a handle really is a single-character wildcard, and
// asking for @john_doe can return @john.doe, a different account.
//
// That cannot mis-classify anyone HERE because each map is keyed on the
// RETURNED ROW's own handle and the query string is then looked up by exact
// equality: an over-matched row lands under its own key and never answers
// for the handle we asked about. Key these maps on the query term instead
// and @john_doe starts resolving to @john.doe's account — and gets paid as
// them. Don't.

import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike } from "@/lib/bulk-invite-utils";

export type HandleKind = "sourced" | "registered" | "invited" | "new";

export type ResolvedHandle = {
  handle: string;
  kind: HandleKind;
  influencerId: string | null;
  invitationId: string | null;
  // Who we already hold a name/followers for, so the preview can show the
  // creator rather than just a handle.
  knownName: string | null;
};

// Handles per OR query. 50 keeps the generated filter string well inside
// PostgREST's URL limit — the same figure fetchExistingHandles uses.
const SUB = 50;

async function lookupBatch<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  column: string,
  select: string,
  handles: string[],
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  const queries = [];
  for (let i = 0; i < handles.length; i += SUB) {
    const slice = handles.slice(i, i + SUB);
    const orFilter = slice.map((h) => `${column}.ilike."${escapeLike(h)}"`).join(",");
    queries.push(client.from(table).select(select).or(orFilter));
  }
  const results = await Promise.all(queries);
  for (const res of results) {
    if (res.error) return { rows: [], error: res.error };
    // The select list is a runtime string, so PostgREST cannot infer the row
    // shape and widens it; the caller names the real one.
    for (const r of res.data || []) rows.push(r as unknown as T);
  }
  return { rows, error: null };
}

export async function resolveHandles(
  admin: SupabaseClient,
  campaignId: string,
  handles: string[],
): Promise<{ error?: string; resolved?: Map<string, ResolvedHandle> }> {
  const unique = [...new Set(handles.map((h) => String(h || "").trim().toLowerCase()).filter(Boolean))];
  const resolved = new Map<string, ResolvedHandle>();
  if (unique.length === 0) return { resolved };

  // Already on this campaign. An equality filter on campaign_id, so no
  // handle batching needed — a campaign's own list is small.
  const bookingsRes = await admin
    .from("campaign_bookings")
    .select("instagram_username")
    .eq("campaign_id", campaignId);
  if (bookingsRes.error) {
    return { error: "Could not read this campaign's sourcing list. Please try again." };
  }
  const sourced = new Set(
    (bookingsRes.data || []).map((r) => String(r.instagram_username || "").toLowerCase()).filter(Boolean),
  );

  const [profiles, invites] = await Promise.all([
    lookupBatch<{ influencer_id: string; instagram_handle: string | null; username: string | null; full_name: string | null }>(
      admin,
      "influencer_profiles",
      "instagram_handle",
      "influencer_id, instagram_handle, username, full_name",
      unique,
    ),
    lookupBatch<{ id: string; instagram_username: string | null; full_name: string | null; influencer_profile_id: string | null }>(
      admin,
      "influencer_invitations",
      "instagram_username",
      "id, instagram_username, full_name, influencer_profile_id",
      unique,
    ),
  ]);
  if (profiles.error || invites.error) {
    return { error: "Could not check the creator database. Please try again." };
  }

  const byProfile = new Map<string, (typeof profiles.rows)[number]>();
  for (const p of profiles.rows) {
    const key = String(p.instagram_handle || p.username || "").toLowerCase();
    if (key) byProfile.set(key, p);
  }
  const byInvite = new Map<string, (typeof invites.rows)[number]>();
  for (const i of invites.rows) {
    const key = String(i.instagram_username || "").toLowerCase();
    // Keep the first: a duplicate invitation is possible (there is no DB
    // unique constraint on the column) and either one links fine.
    if (key && !byInvite.has(key)) byInvite.set(key, i);
  }

  for (const handle of unique) {
    const profile = byProfile.get(handle);
    const invite = byInvite.get(handle);
    // "Already on the list" wins over everything: it means do nothing,
    // whatever else we know about them.
    if (sourced.has(handle)) {
      resolved.set(handle, {
        handle,
        kind: "sourced",
        influencerId: profile?.influencer_id ?? invite?.influencer_profile_id ?? null,
        invitationId: invite?.id ?? null,
        knownName: profile?.full_name ?? invite?.full_name ?? null,
      });
    } else if (profile) {
      resolved.set(handle, {
        handle,
        kind: "registered",
        influencerId: profile.influencer_id,
        invitationId: invite?.id ?? null,
        knownName: profile.full_name ?? null,
      });
    } else if (invite) {
      resolved.set(handle, {
        handle,
        kind: "invited",
        influencerId: invite.influencer_profile_id ?? null,
        invitationId: invite.id,
        knownName: invite.full_name ?? null,
      });
    } else {
      resolved.set(handle, { handle, kind: "new", influencerId: null, invitationId: null, knownName: null });
    }
  }

  return { resolved };
}
