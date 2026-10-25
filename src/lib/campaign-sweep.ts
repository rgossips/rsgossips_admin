import type { SupabaseClient } from "@supabase/supabase-js";
import { CLOSED_AFFECTED } from "@/app/dashboard/campaigns/[id]/campaign-transition-constants";
import { logError } from "@/lib/log";

// Campaigns end; their leftover applications do not close themselves.
//
// WHAT THIS IS FOR. A campaign finishing is not an event anything listens
// for — there is no job, no trigger and no status change — so an admin who
// never opens the campaign again leaves every undecided applicant sitting
// on "Pending Review" forever. Measured when this was written: 43 campaigns
// had passed their `campaign_end_date` while still marked `active`, the
// oldest 65 days earlier, carrying 458 undecided applications from 319
// creators. Every one of those people was waiting on an answer that was
// never coming.
//
// WHY IT IS NOT THE PER-CAMPAIGN FLOW IN A LOOP. coming-soon-actions.ts
// already closes one campaign's applications properly, and this reuses its
// rules — CLOSED_AFFECTED, the `closed` target, the same email and
// notification. What it cannot reuse is the MESSAGING, because that flow
// sends one message per application. Across 43 campaigns that is 458
// messages to 319 people: 52 creators would get 2, 26 would get 3, and one
// would get NINE emails and nine push notifications within a few minutes.
// So the sweep groups by creator and sends each person one message naming
// every campaign of theirs that closed.
//
// WHAT "ENDED" MEANS. `campaign_end_date`, not `application_deadline`. A
// passed deadline only means the campaign stopped taking applications; it
// may still be running and a brand may still approve someone. Only an ended
// campaign makes the email's claim — "has finished" — true. Measured, the
// difference is 338 applications on 29 campaigns that are still live.
//
// The date is compared with the END-OF-DAY rule from campaign-deadline.ts,
// not `new Date(v) < now`: these columns store a zone-less midnight, so a
// raw comparison calls a campaign ending today "ended" from 05:30 IST that
// morning. Same bug that module exists to kill.

/**
 * True once the whole of the stored day has passed.
 *
 * The calendar date is read out of the STRING, not via `new Date()`. These
 * columns hold a zone-less midnight ("2026-10-24T00:00:00"), so `new Date()`
 * resolves them in the RUNTIME's zone — correct on Netlify, which is UTC,
 * and 5.5 hours out when the same code runs on an IST machine. Parsing the
 * parts makes the answer identical everywhere, which is what rgossips_web's
 * `_shared/campaign-dates.ts` does and why. Keep the two in step.
 *
 * The day itself still counts: a campaign whose end date is today has not
 * ended. Cutting that short is the bug the upstream module exists to kill.
 */
export function dayHasPassed(value: string | null | undefined, now: number = Date.now()): boolean {
  if (!value) return false;
  const ymd = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endOfDay = ymd
    ? Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 23, 59, 59, 999)
    : (() => {
        const d = new Date(value);
        return Number.isNaN(d.getTime())
          ? NaN
          : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
      })();
  if (Number.isNaN(endOfDay)) return false;
  return now > endOfDay;
}

export type SweepCreator = {
  influencerId: string;
  name: string;
  email: string | null;
  /** Their undecided applications on ended campaigns. */
  applicationIds: string[];
  /** Titles of those campaigns, for the email. */
  campaignTitles: string[];
};

export type SweepPlan = {
  error?: string;
  /** Ended campaigns still not marked `completed`. */
  campaignsToComplete: string[];
  /** Every ended campaign, whether or not it has undecided applications. */
  endedCampaignIds: string[];
  /** How many ended campaigns actually carry undecided applications. */
  campaignsWithUndecided: number;
  applicationIds: string[];
  creators: SweepCreator[];
  /**
   * Undecided rows whose `influencer_id` is null — invitation-backed, from
   * the outreach handoff (migration 088). They are closed like the rest but
   * cannot be told, because there is no account to notify.
   */
  unreachable: number;
};

const EMPTY: SweepPlan = {
  campaignsToComplete: [],
  endedCampaignIds: [],
  campaignsWithUndecided: 0,
  applicationIds: [],
  creators: [],
  unreachable: 0,
};

async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  scope: string,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) {
      logError(scope, error, { from });
      return null;
    }
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Read-only. What a sweep WOULD do, so the number is seen before anything
 * is sent. Called again inside the apply step rather than trusted from the
 * client — see sweep-actions.ts.
 */
export async function buildEndedCampaignSweep(
  admin: SupabaseClient,
  now: number = Date.now(),
): Promise<SweepPlan> {
  const campaigns = await pageAll<{
    campaign_id: string;
    title: string | null;
    status: string | null;
    campaign_end_date: string | null;
  }>(
    (f, t) =>
      admin.from("campaigns").select("campaign_id, title, status, campaign_end_date").range(f, t),
    "campaign-sweep.campaigns",
  );
  if (!campaigns) return { ...EMPTY, error: "Could not read the campaigns." };

  const ended = campaigns.filter((c) => dayHasPassed(c.campaign_end_date, now));
  if (ended.length === 0) return EMPTY;

  const titleOf = new Map(ended.map((c) => [c.campaign_id, c.title || "a campaign"]));
  const endedIds = ended.map((c) => c.campaign_id);

  const apps = await pageAll<{ id: string; campaign_id: string; influencer_id: string | null }>(
    (f, t) =>
      admin
        .from("campaign_applications")
        .select("id, campaign_id, influencer_id")
        .in("campaign_id", endedIds)
        .in("status", CLOSED_AFFECTED as unknown as string[])
        .range(f, t),
    "campaign-sweep.applications",
  );
  if (!apps) return { ...EMPTY, error: "Could not read the applications." };

  const byCreator = new Map<string, { applicationIds: string[]; titles: Set<string> }>();
  const campaignsSeen = new Set<string>();
  let unreachable = 0;
  for (const a of apps) {
    campaignsSeen.add(a.campaign_id);
    if (!a.influencer_id) {
      unreachable++;
      continue;
    }
    if (!byCreator.has(a.influencer_id)) {
      byCreator.set(a.influencer_id, { applicationIds: [], titles: new Set() });
    }
    const e = byCreator.get(a.influencer_id)!;
    e.applicationIds.push(a.id);
    e.titles.add(titleOf.get(a.campaign_id) || "a campaign");
  }

  // Names and addresses come from the profile, never from a caller.
  const ids = [...byCreator.keys()];
  const profiles = ids.length
    ? await pageAll<{ influencer_id: string; full_name: string | null; username: string | null; instagram_handle: string | null; email: string | null }>(
        (f, t) =>
          admin
            .from("influencer_profiles")
            .select("influencer_id, full_name, username, instagram_handle, email")
            .in("influencer_id", ids)
            .range(f, t),
        "campaign-sweep.profiles",
      )
    : [];
  if (!profiles) return { ...EMPTY, error: "Could not read the creators." };

  const profileOf = new Map(profiles.map((p) => [p.influencer_id, p]));
  const creators: SweepCreator[] = ids.map((id) => {
    const p = profileOf.get(id);
    const e = byCreator.get(id)!;
    return {
      influencerId: id,
      name: p?.full_name || p?.username || p?.instagram_handle || "Creator",
      email: p?.email || null,
      applicationIds: e.applicationIds,
      // Most creators have one; the sort keeps a multi-campaign email stable
      // between the preview and the message actually sent.
      campaignTitles: [...e.titles].sort(),
    };
  });
  // Busiest first, so if a run is interrupted the people owed the most
  // messages have already had theirs.
  creators.sort((a, b) => b.applicationIds.length - a.applicationIds.length);

  return {
    campaignsToComplete: ended.filter((c) => c.status !== "completed").map((c) => c.campaign_id),
    endedCampaignIds: endedIds,
    campaignsWithUndecided: campaignsSeen.size,
    applicationIds: apps.map((a) => a.id),
    creators,
    unreachable,
  };
}
