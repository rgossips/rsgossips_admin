import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllAuthUsers } from "@/lib/phone-search";
import { invitationAsProfile } from "@/lib/invitation-meta";

/**
 * A campaign's applications, ready to render.
 *
 * Two pages need exactly this — the campaign detail page for its headline
 * numbers, and the full applications page for the list itself — and the
 * preparation is not trivial: an embed that returns nothing for
 * invitation-backed rows, and phone numbers that live on a different table
 * entirely. Two copies would drift, and the first symptom would be the two
 * screens disagreeing about how many applicants a campaign has.
 */

export type LoadedApplications = {
  // `any` because the row is the whole table plus an embed, and every
  // consumer narrows it differently. Matches what the detail page already
  // passed down.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applications: any[];
  /** influencer_id -> phone. Phones live on auth.users, never on the profile. */
  phones: Record<string, string>;
};

export async function loadCampaignApplications(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<LoadedApplications> {
  // location + gender are here for the match ranking (lib/application-match.ts).
  // Both are sparse (location 14%, gender 51% of profiles), which the scorer
  // treats as "unknown" rather than as a mismatch.
  const { data } = await supabase
    .from("campaign_applications")
    .select(
      "*, influencer_profiles(full_name, username, profile_photo_url, followers_count, instagram_handle, categories, bio, engagement_rate, email, media_kit_published, location, gender)",
    )
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  const applications = data || [];

  // An application can belong to an INVITATION rather than a profile — an
  // outreach creator approved before they ever signed up (rgossips_web
  // migration 088). PostgREST returns no influencer_profiles for those, so
  // without this the row renders with no name and the scorer reads every
  // dimension as unknown. Dressed as a profile once, here, rather than
  // teaching the list, the scorer and the export that a creator comes in
  // two shapes.
  const unlinked = applications.filter(
    (a) => !a.influencer_profiles && a.influencer_invitation_id,
  );
  if (unlinked.length > 0) {
    const { data: invites } = await supabase
      .from("influencer_invitations")
      .select("id, full_name, instagram_username, profile_photo_url, notes")
      .in("id", [...new Set(unlinked.map((a) => a.influencer_invitation_id))]);
    const byId = new Map((invites || []).map((i) => [String(i.id), i]));
    for (const a of unlinked) {
      const inv = byId.get(String(a.influencer_invitation_id));
      // A missing invitation leaves the row as it was. Better a sparse row
      // than a fabricated creator.
      if (inv) a.influencer_profiles = invitationAsProfile(inv);
    }
  }

  // Phones are on auth.users and cannot be joined, so they come from the
  // cross-request cache in phone-search.ts rather than a lookup per row.
  const applicantIds = new Set(
    applications.map((a) => a.influencer_id).filter(Boolean) as string[],
  );
  const phones: Record<string, string> = {};
  if (applicantIds.size > 0) {
    try {
      for (const u of await listAllAuthUsers(supabase)) {
        if (u.phone && applicantIds.has(u.id)) phones[u.id] = u.phone;
      }
    } catch {
      // A failed phone read is a blank column, never a blank page.
    }
  }

  return { applications, phones };
}

/** Counts per application status, for the tabs and the headline numbers. */
export function countByStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applications: any[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of applications) {
    const s = String(a.status || "unknown");
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}
