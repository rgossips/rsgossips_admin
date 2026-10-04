// Every creator sourced by hand also enters the creator database.
//
// The whole point of moving this process off a spreadsheet: a creator an
// admin found, DM'd and paid should not vanish when the campaign ends. One
// manual entry or three hundred imported rows, all of them pass through
// here, so sourcing grows the platform instead of a Google Sheet.
//
// A handle resolves to exactly one of three outcomes:
//
//   registered  — they already have a profile. Link to it, create nothing.
//   invited     — a pending invitation already exists. Link to it, create
//                 nothing. This is the COMMON case, not an error: the sheets
//                 are full of creators we have already invited, and the
//                 bulk-invite action treats that as a row failure, which is
//                 why this flow cannot reuse it.
//   new         — neither. Create an influencer_invitations row with the
//                 standard notes trailer, so create-profile carries the
//                 metadata onto the profile when they claim it.
//
// The caller resolves the handle ONCE and reuses the result; it is the
// expensive part of importing a 300-row sheet.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";

export type EnsureResult = {
  outcome: "registered" | "invited" | "created" | "error";
  influencerId: string | null;
  invitationId: string | null;
  error?: string;
};

export type EnsureInput = {
  instagramUsername: string;
  fullName?: string | null;
  // Admin-curated metadata that must survive the claim. Written into the
  // notes trailer, which create-profile reads — see CLAUDE.md, "Invitation →
  // profile claim".
  city?: string | null;
  gender?: string | null;
  categories?: string[];
  languages?: string[];
  tags?: string[];
  creatorType?: string | null;
  note?: string | null;
};

const normalizeHandle = (raw: string) =>
  String(raw || "")
    .trim()
    .replace(/^@/, "")
    // Sheets paste full profile URLs more often than bare handles.
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?].*$/, "")
    .toLowerCase();

// LIKE wildcards in a handle would silently widen the lookup: an underscore
// matches any character, and "a_b" would collide with "aXb".
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function buildNotes(input: EnsureInput): string {
  const metadata: Record<string, unknown> = {};
  if (input.city) metadata.city = input.city;
  if (input.gender) metadata.gender = input.gender;
  if (input.categories?.length) metadata.categories = input.categories;
  if (input.languages?.length) metadata.languages = input.languages;
  if (input.tags?.length) metadata.tags = input.tags;
  if (input.creatorType) metadata.creator_type = input.creatorType;
  const prose = (input.note || "").trim();
  if (Object.keys(metadata).length === 0) return prose;
  return prose ? `${prose}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
}

export async function ensureInvitation(
  admin: SupabaseClient,
  input: EnsureInput,
  actorId: string | null,
): Promise<EnsureResult> {
  const handle = normalizeHandle(input.instagramUsername);
  if (!handle) return { outcome: "error", influencerId: null, invitationId: null, error: "No Instagram handle" };
  const pattern = escapeLike(handle);

  // Registered already?
  const { data: profile, error: profileErr } = await admin
    .from("influencer_profiles")
    .select("influencer_id")
    .ilike("instagram_handle", pattern)
    .limit(1);
  if (profileErr) {
    logError("sourcing.ensure-invitation.profile", profileErr, { handle });
    // A FAILED lookup must never be read as "not found" — that would create
    // a duplicate invitation for someone who already has an account.
    return { outcome: "error", influencerId: null, invitationId: null, error: "Could not check existing creators. Try again." };
  }
  if (profile?.length) {
    return { outcome: "registered", influencerId: profile[0].influencer_id, invitationId: null };
  }

  // Already invited?
  const { data: invite, error: inviteErr } = await admin
    .from("influencer_invitations")
    .select("id, influencer_profile_id")
    .ilike("instagram_username", pattern)
    .limit(1);
  if (inviteErr) {
    logError("sourcing.ensure-invitation.invite", inviteErr, { handle });
    return { outcome: "error", influencerId: null, invitationId: null, error: "Could not check existing invitations. Try again." };
  }
  if (invite?.length) {
    return {
      outcome: "invited",
      influencerId: invite[0].influencer_profile_id ?? null,
      invitationId: invite[0].id,
    };
  }

  // Neither — invite them.
  const { data: created, error: createErr } = await admin
    .from("influencer_invitations")
    .insert({
      full_name: input.fullName || null,
      instagram_username: handle,
      notes: buildNotes(input) || null,
      created_by: actorId,
      status: "pending",
    })
    .select("id")
    .single();
  if (createErr) {
    // A unique violation here means a concurrent import got there first;
    // re-read rather than fail the row.
    const { data: raced } = await admin
      .from("influencer_invitations")
      .select("id")
      .ilike("instagram_username", pattern)
      .limit(1);
    if (raced?.length) return { outcome: "invited", influencerId: null, invitationId: raced[0].id };
    logError("sourcing.ensure-invitation.create", createErr, { handle });
    return { outcome: "error", influencerId: null, invitationId: null, error: "Could not create the invitation." };
  }

  return { outcome: "created", influencerId: null, invitationId: created.id };
}

export { normalizeHandle };
