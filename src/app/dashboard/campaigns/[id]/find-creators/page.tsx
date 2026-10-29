import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getAdminProfile, isAdminOrAbove } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";
import { countSeats, describeSeats } from "@/lib/sourcing/seats";
import { defaultFulfilmentMode } from "@/lib/sourcing/stages";
import { requiredGender } from "@/lib/gender-target";
import { inviteBlockedReason } from "@/lib/campaign-invite";
import { listAssignableAdmins } from "../sourcing/outreach-actions";
import { MatchPanel, type MatchBrief } from "./match-panel";

export const dynamic = "force-dynamic";

// A static segment beats the sibling [id] route, so this is
// /dashboard/campaigns/<id>/find-creators and never a campaign called
// "find-creators".
//
// Its own page rather than the inline panel on the Outreach tracker: this
// one carries filters, an outreach message, a per-row DM link, a Copy
// button and an Excel download, which is a screenful of apparatus that has
// no business unfolding inside a tracker row. The tracker keeps its quick
// picker for when you already know who you want.

// The campaign metadata trailer: prose, a blank line, a "---" line, then
// JSON. SIX characters — slicing at +5 leaves a stray newline that
// JSON.parse happens to tolerate, which is why that bug survives elsewhere
// in this codebase.
const CAMPAIGN_TRAILER = "\n\n---\n";
function parseTrailer(description: string | null | undefined): Record<string, unknown> {
  const raw = String(description || "");
  const at = raw.indexOf(CAMPAIGN_TRAILER);
  const json = at !== -1 ? raw.slice(at + CAMPAIGN_TRAILER.length) : raw.trimStart().startsWith("{") ? raw : "";
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];

export default async function FindCreatorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Read-only, but it puts the whole creator base — names, cities, emails —
  // on one screen, and the Start-tracking button writes. Gated like the
  // rest of the dashboard rather than left open because "it is only a list".
  if (!(await isAdminOrAbove())) redirect(`/dashboard/campaigns/${id}`);

  const admin = createAdminClient();
  const me = await getAdminProfile();
  const adminList = await listAssignableAdmins();
  const admins = adminList.admins || [];
  // The assignee dropdown is uncontrolled-looking if its value is not one
  // of its options: the browser shows the first admin while the state holds
  // somebody else, and the import then assigns the creators to the wrong
  // person. Only reachable if the signed-in admin is somehow absent from
  // admin_profiles, but a silent mis-assignment is worth one line.
  const defaultAssignee = admins.some((a) => a.id === me.userId) ? me.userId || "" : admins[0]?.id || "";

  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select(
      "campaign_id, title, status, application_deadline, campaign_end_date, max_influencers, description, target_categories, target_cities, target_follower_min, target_follower_max, brand_profiles(brand_name), brand_invitations(brand_name)",
    )
    .eq("campaign_id", id)
    .maybeSingle();
  if (campErr) logError("findCreators.campaign", campErr, { id });
  if (!campaign) notFound();

  const [bookingsRes, appsRes] = await Promise.all([
    admin.from("campaign_bookings").select("influencer_id, invitation_id, instagram_username, stage").eq("campaign_id", id),
    admin.from("campaign_applications").select("influencer_id, status").eq("campaign_id", id),
  ]);
  // Migration 081 not applied yet is a state to degrade through, not an
  // error to log: without bookings the seat count is just the applications,
  // and the panel still finds and messages creators.
  if (bookingsRes.error && bookingsRes.error.code !== "PGRST205") {
    logError("findCreators.bookings", bookingsRes.error, { id });
  }

  const seats = countSeats(campaign.max_influencers, appsRes.data || [], bookingsRes.data || []);

  const meta = parseTrailer(campaign.description);
  const brief: MatchBrief = {
    categories: asStrings(campaign.target_categories),
    cities: asStrings(campaign.target_cities),
    followerMin: campaign.target_follower_min ?? null,
    followerMax: campaign.target_follower_max ?? null,
    // target_gender is NOT a column — it lives in the trailer. Null unless
    // the brief names exactly one gender, which is what makes it a
    // restriction; the ranking action applies the exclusion itself.
    requiredGender: requiredGender(meta.target_gender),
  };

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const camp = campaign as any;
  const brandName = camp.brand_profiles?.brand_name || camp.brand_invitations?.brand_name || "—";
  const title = campaign.title || "Campaign";

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/campaigns/${id}`}
            className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            ← {title}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Find matching creators</h1>
          <p className="text-[12px] text-gray-500">
            {brandName} · creators already in our database, ranked against this brief. Message them yourself, or put
            them on the{" "}
            <Link href={`/dashboard/campaigns/${id}/sourcing`} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
              outreach tracker
            </Link>
            .
          </p>
        </div>
        <Link
          href="/dashboard/scouting"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Scout new creators on Instagram
        </Link>
      </div>

      <MatchPanel
        campaignId={id}
        campaignTitle={title}
        brief={brief}
        admins={admins}
        currentAdminId={defaultAssignee}
        defaultMode={defaultFulfilmentMode(meta)}
        seatsFull={seats.capacity !== null && seats.remaining === 0}
        seatsNote={describeSeats(seats)}
        // Why the invite button is off, computed with the SAME predicate the
        // action re-checks. Said before the click, because choosing twenty
        // people and then being refused is the worse order.
        inviteBlocked={inviteBlockedReason(
          campaign.status,
          campaign.application_deadline,
          campaign.campaign_end_date,
        )}
      />
    </div>
  );
}
