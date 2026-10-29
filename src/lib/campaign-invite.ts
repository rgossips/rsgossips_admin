// Inviting a creator to a campaign from the admin portal, and remembering
// that we did.
//
// This is the admin-side twin of the consumer app's `inviteInfluencers`
// action in `rgossips_web/supabase/functions/brand-campaigns/index.ts`,
// where a BRAND hand-picks creators for its own campaign. Deliberately the
// same spine rather than a parallel one:
//
//   * `campaign_invitations` (rgossips_web migration 055) is the tracking
//     row. `apply-campaign` flips it to 'responded' when the creator
//     applies, so "have they answered us?" is already maintained for free.
//   * `list-campaigns` keeps an invited campaign VISIBLE to the creator it
//     was sent to even when the brief would otherwise hide it, so the
//     notification cannot point at something they then cannot find.
//   * the `campaign_invite` notification type is already routed by both
//     consumer notification UIs and already gated by the creator's own
//     `campaignUpdates` preference (the 055 trigger).
//
// A second, admin-only ledger would have had to re-earn all three.
//
// WHO CAN BE INVITED THIS WAY. `campaign_invitations.influencer_id` is an
// auth.users id, so the row — and the in-app notification, and the push it
// fires — only exist for a REGISTERED creator. The other half of our pool
// is invited-but-not-signed-up, with no account and no device to push to;
// for them email is the only channel there is, and the fact that we wrote
// to them is recorded in the invitation's own notes trailer instead. Hence
// two ledgers for one question, and `INVITE_NOTES_KEY` below.

import { applicationsClosed, dayHasPassed } from "@/lib/campaign-deadline";

/**
 * The creator-facing app. Emails from here must link to THAT site, never to
 * `getSiteUrl()` — which is the admin portal, and would send a creator to a
 * login they cannot pass.
 *
 * One owner: `application-emails.ts` and `campaign-suggestions.ts` import
 * this rather than keeping the private copies they used to have.
 */
export const CREATOR_SITE = "https://rgossips.com";

/** Where a registered creator reads the brief and applies. */
export function campaignUrl(campaignId: string): string {
  return `${CREATOR_SITE}/influencer/offers/${campaignId}`;
}

/**
 * Where somebody with no account starts.
 *
 * Deliberately the same URL the manual onboarding invite uses — the
 * `invited` handle is what lets the landing page prefill the Instagram
 * step. No campaign id is appended: nothing on that page reads one, and a
 * parameter that quietly does nothing is worse than not promising it.
 */
export function signupUrl(handle: string): string {
  return `${CREATOR_SITE}/?invited=${encodeURIComponent(String(handle || "").replace(/^@/, ""))}`;
}

/**
 * The notes-trailer key recording which campaigns we have emailed an
 * un-registered creator about: `{ "<campaign uuid>": "<iso timestamp>" }`.
 *
 * A map rather than a list of ids because the date is what makes the badge
 * useful ("notified 3 days ago" vs "notified"), and a trailer key is the
 * house pattern for metadata that would otherwise be schema churn (see
 * CLAUDE.md, "Description / notes trailer metadata").
 */
export const INVITE_NOTES_KEY = "campaign_invites";

/**
 * Read that map out of an already-parsed notes trailer.
 *
 * Tolerant on purpose: the trailer is hand-edited in places and written by
 * the HikerAPI enrichment in others, so anything that is not an object of
 * strings reads as "we have told them nothing", which is the safe answer —
 * it risks one duplicate email, where the opposite risks silently never
 * contacting somebody.
 */
export function inviteMapFromMeta(meta: Record<string, unknown> | null | undefined): Record<string, string> {
  const raw = meta?.[INVITE_NOTES_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** When we last emailed this creator about this campaign, if we have. */
export function invitedAtFromMeta(
  meta: Record<string, unknown> | null | undefined,
  campaignId: string,
): string | null {
  return inviteMapFromMeta(meta)[campaignId] || null;
}

/**
 * How many creators one call may notify.
 *
 * The CLIENT chunks a bigger selection into calls of this size and runs the
 * sends inside a chunk in parallel — the same shape as bulk invite and the
 * photo enrichment, and for the same reason: every email is a round trip to
 * the `send-email` edge function, and 200 of them in series does not finish
 * inside a Netlify function's budget.
 */
export const INVITE_CHUNK_SIZE = 10;

/** Mirrors the brand side's cap, so one campaign cannot be blasted at. */
export const MAX_INVITE_TOTAL = 200;

/** A short "3 days ago" for the row badge. */
export function invitedAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`;
}

/**
 * Why this campaign cannot be invited to, or null if it can.
 *
 * ONE owner, used by the page (to explain the disabled button before the
 * click) and by the action (which re-checks it and refuses). A button and
 * the thing it triggers must share a predicate — two hand-written status
 * lists is how the campaign applications list ended up with a Reject button
 * that rendered on rows its own confirm panel would not open.
 *
 * Both gates mirror the brand side's `inviteInfluencers`, and for the same
 * reason it closed them: a creator who gets a push for a campaign its own
 * page calls Closed has been handed a dead end, and a campaign one deadline
 * extension away from live is not a reason to send one.
 */
export function inviteBlockedReason(
  status: string | null | undefined,
  deadline: string | null | undefined,
  endDate: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (status !== "active") {
    return `This campaign is ${status || "not live"}, so creators can't be invited to it yet. Make it active first.`;
  }
  if (dayHasPassed(endDate, now)) {
    return "This campaign has ended, so there's nothing for an invited creator to apply to.";
  }
  if (applicationsClosed(status || null, deadline || null, now)) {
    return "Applications for this campaign have closed. Extend the application deadline to invite creators.";
  }
  return null;
}
