"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { updateApplicationStatus } from "../actions";
import { ButtonSpinner } from "@/components/spinner";
import { Avatar } from "@/components/avatar";
import { useRole } from "@/components/role-context";
import { ExportApplicantsButton } from "./export-applicants-button";
import { APPLICATION_STATUS_BADGE } from "@/lib/application-status";
import { InstagramLink } from "@/components/instagram-link";
import { FulfilmentPanel } from "./fulfilment-panel";
import type { ShippingMode } from "@/lib/barter-fulfilment";
import { bulkRejectApplications } from "./bulk-reject-actions";
import {
  scoreApplicant,
  rankByMatch,
  matchTone,
  type MatchResult,
  type MatchTarget,
  type Verdict,
} from "@/lib/application-match";

interface Application {
  id: string;
  campaign_id: string;
  influencer_id: string;
  initiated_by: string;
  proposed_rate: number | null;
  brand_offered_rate: number | null;
  final_agreed_rate: number | null;
  status: string;
  rejection_reason: string | null;
  submission_links: Array<{ url: string; type: string; label: string }> | null;
  created_at: string;
  // Barter fulfilment (rgossips_web migration 076). The page selects *, so
  // these arrive without widening the query.
  shipping_address: string | null;
  shipping_address_updated_at: string | null;
  shipping_address_requested_at: string | null;
  shipping_tracking_url: string | null;
  shipping_carrier: string | null;
  shipping_tracking_added_at: string | null;
  shipping_expected_at: string | null;
  product_received: boolean | null;
  product_received_at: string | null;
  product_feedback: string | null;
  influencer_profiles: {
    full_name: string | null;
    username: string | null;
    profile_photo_url: string | null;
    followers_count: number | null;
    instagram_handle: string | null;
    categories: string[] | null;
    bio: string | null;
    engagement_rate: number | null;
    email: string | null;
    media_kit_published: boolean | null;
    // Sparse in practice (location 14%, gender 51%) — the match scorer reads
    // an absent value as "unknown", never as a mismatch.
    location: string | null;
    gender: string | null;
  } | null;
}

// Colours live in lib/application-status.ts — the influencer detail page's
// "Applied campaigns" card renders the same statuses.
const statusConfig: Record<string, { bg: string }> = Object.fromEntries(
  Object.entries(APPLICATION_STATUS_BADGE).map(([k, bg]) => [k, { bg }]),
);

function formatCount(n: number | null) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// Module scope, never nested inside a stateful component — a component
// redefined each render remounts its children (see CLAUDE.md).
const MATCH_TONE: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  fair: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  weak: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  none: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const VERDICT_MARK: Record<Verdict, string> = { match: "✓", miss: "✗", unknown: "?" };
const VERDICT_TONE: Record<Verdict, string> = {
  match: "text-emerald-600 dark:text-emerald-400",
  miss: "text-rose-600 dark:text-rose-400",
  unknown: "text-gray-400 dark:text-gray-500",
};

/**
 * The score, with its reasoning one hover away.
 *
 * The reasons are not decoration: a ranking a brand or an admin cannot
 * interrogate is one they will not trust, and "?" markers are what stop
 * someone reading a middling score as a judgement when it really means the
 * profile is thin.
 */
function MatchBadge({ result, label, whyLabel }: { result: MatchResult; label: string; whyLabel: string }) {
  if (result.percent === null) return null;
  return (
    <span className="relative inline-flex items-center group">
      <span
        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${MATCH_TONE[matchTone(result.percent)]}`}
      >
        {label}
      </span>
      {result.dimensions.length > 0 && (
        <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-max max-w-xs rounded-lg border border-gray-200 bg-white p-2 text-left shadow-lg group-hover:block dark:border-gray-700 dark:bg-gray-900">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {whyLabel}
          </span>
          {result.dimensions.map((d) => (
            <span key={d.key} className="block text-[11px] text-gray-600 dark:text-gray-300">
              <span className={`mr-1 font-bold ${VERDICT_TONE[d.verdict]}`}>{VERDICT_MARK[d.verdict]}</span>
              {d.label}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export function ApplicationsList({
  campaignId,
  applications,
  budgetPerInfluencer,
  campaignType,
  shippingMode,
  phones = {},
  targeting,
}: {
  campaignId: string;
  applications: Application[];
  budgetPerInfluencer: number;
  // From the campaign's description trailer: does anything physical move?
  shippingMode: ShippingMode;
  // "barter" | "paid" | "hybrid" — barter pays nothing, so its approval flow
  // has no amount, no escrow and no payout downstream.
  campaignType: string;
  // influencer_id -> phone. Phones live on auth.users, never on
  // influencer_profiles, so the page fetches them separately.
  phones?: Record<string, string>;
  // The campaign's own brief, for ranking applicants against it.
  targeting?: MatchTarget;
}) {
  const t = useTranslations("DashboardCampaignsIdApplications");
  const router = useRouter();
  const { isAdmin } = useRole();
  const [sortMode, setSortMode] = useState<"match" | "newest">("match");
  const [hideUnderMin, setHideUnderMin] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  // Score once per render pass, not once per row: the row component would
  // otherwise recompute on every one of its own state changes.
  const scored = useMemo(() => {
    const target = targeting || {};
    return (applications || []).map((app) => ({
      app,
      match: scoreApplicant(
        {
          followersCount: app.influencer_profiles?.followers_count,
          categories: app.influencer_profiles?.categories,
          location: app.influencer_profiles?.location,
          engagementRate: app.influencer_profiles?.engagement_rate,
          gender: app.influencer_profiles?.gender,
        },
        target,
      ),
    }));
  }, [applications, targeting]);

  const ordered = useMemo(() => {
    if (sortMode === "newest") {
      // The page already returns newest-first; keep that exact order rather
      // than re-sorting on a date string.
      return scored;
    }
    return rankByMatch(
      scored,
      (s) => s.match,
      (s) => s.app.influencer_profiles?.followers_count,
    );
  }, [scored, sortMode]);

  // "Under the follower minimum" means KNOWN to be under it. A creator whose
  // follower count we do not hold is never swept up by this — hiding or
  // rejecting someone for missing data would be a different decision than
  // the one the button describes.
  const underMin = useMemo(() => ordered.filter((s) => s.match.belowFollowerMin), [ordered]);
  // Only the undecided ones can be bulk rejected; the server enforces this
  // again, and the count here has to agree with what it will actually do.
  const rejectable = useMemo(
    () => underMin.filter((s) => s.app.status === "pending" || s.app.status === "on_hold"),
    [underMin],
  );

  const visible = hideUnderMin ? ordered.filter((s) => !s.match.belowFollowerMin) : ordered;

  const followerMin = Number(targeting?.followerMin) || 0;

  async function runBulkReject() {
    setBulkBusy(true);
    const res = await bulkRejectApplications(
      campaignId,
      rejectable.map((s) => s.app.id),
      bulkReason.trim() || undefined,
    );
    setBulkBusy(false);
    if (res.error) {
      setBulkNote(res.error);
      return;
    }
    setBulkOpen(false);
    setBulkReason("");
    setBulkNote(
      [
        t("bulkRejectDone", { count: res.rejected ?? 0 }),
        res.skipped ? t("bulkRejectSkipped", { count: res.skipped }) : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    router.refresh();
  }

  // Hooks must run before this, so the empty case returns last.
  if (!applications || applications.length === 0) return null;

  const pending = applications.filter((a) => a.status === "pending").length;
  const approved = applications.filter((a) => a.status === "approved" || a.status === "accepted").length;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("applications")}</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">{applications.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {pending > 0 && <span className="text-amber-600 dark:text-amber-400 font-semibold">{t("pendingCount", { count: pending })}</span>}
          {approved > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{t("approvedCount", { count: approved })}</span>}
          <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <span>{t("sortLabel")}</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as "match" | "newest")}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="match">{t("sortMatch")}</option>
              <option value="newest">{t("sortNewest")}</option>
            </select>
          </label>
          <ExportApplicantsButton campaignId={campaignId} />
        </div>
      </div>

      {/* Under-spec controls. Only shown when the brief sets a minimum AND
          somebody is actually under it — otherwise they are two buttons that
          can never do anything. */}
      {followerMin > 0 && underMin.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50 px-6 py-3 dark:border-gray-800 dark:bg-gray-900/50">
          <button
            type="button"
            onClick={() => setHideUnderMin((v) => !v)}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {hideUnderMin
              ? t("showAllApplicants")
              : t("hideUnderMin", { min: followerMin.toLocaleString(), count: underMin.length })}
          </button>
          {isAdmin && rejectable.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setBulkNote(null);
                setBulkOpen(true);
              }}
              className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500"
            >
              {t("bulkRejectCta", { count: rejectable.length })}
            </button>
          )}
          {bulkNote && <span className="text-xs text-gray-600 dark:text-gray-400">{bulkNote}</span>}
        </div>
      )}

      {bulkOpen && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm font-semibold text-red-900 dark:text-red-200">
            {t("bulkRejectHeading", { count: rejectable.length })}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-red-800 dark:text-red-300">{t("bulkRejectBody")}</p>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-red-900 dark:text-red-200">{t("bulkRejectReasonLabel")}</span>
            <textarea
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t("bulkRejectReasonPlaceholder")}
              className="mt-1 w-full rounded-lg border border-red-300 bg-white px-2 py-1.5 text-xs dark:border-red-800 dark:bg-gray-900"
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runBulkReject()}
              disabled={bulkBusy}
              aria-busy={bulkBusy}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-wait disabled:opacity-60"
            >
              {bulkBusy && <ButtonSpinner />}
              {t("bulkRejectConfirm", { count: rejectable.length })}
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(false)}
              disabled={bulkBusy}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-900 disabled:opacity-50 dark:border-red-800 dark:text-red-200"
            >
              {t("bulkRejectCancel")}
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {visible.map(({ app, match }) => (
          <ApplicationRow
            key={app.id}
            application={app}
            budgetPerInfluencer={budgetPerInfluencer}
            isBarter={campaignType === "barter"}
            shippingMode={shippingMode}
            phone={phones[app.influencer_id] || null}
            match={match}
            followerMin={followerMin}
          />
        ))}
      </div>
    </div>
  );
}

function ApplicationRow({
  application,
  budgetPerInfluencer,
  isBarter,
  shippingMode,
  phone,
  match,
  followerMin,
}: {
  application: Application;
  budgetPerInfluencer: number;
  isBarter: boolean;
  shippingMode: ShippingMode;
  phone?: string | null;
  match?: MatchResult;
  followerMin?: number;
}) {
  const t = useTranslations("DashboardCampaignsIdApplications");
  const router = useRouter();
  const { isAdmin } = useRole();
  const [loading, setLoading] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionIndexes, setRevisionIndexes] = useState<number[]>([]);
  const [payAmount, setPayAmount] = useState(String(application.proposed_rate || budgetPerInfluencer || 0));
  const [payNote, setPayNote] = useState("");
  const inf = application.influencer_profiles;
  const stKey = statusConfig[application.status] ? application.status : "pending";
  const st = statusConfig[stKey];
  const statusLabel = (s: string) => (statusConfig[s] ? t(`status.${s}`) : s);

  // Free-form status change for admins. Bypasses the rich Approve/Reject/
  // Revision flows — use those when you need to attach a rate, reason, or
  // revision note. This is for corrections / out-of-band transitions.
  const handleOverride = async (next: string) => {
    if (next === application.status) {
      setOverrideOpen(false);
      return;
    }
    if (!confirm(t("overrideConfirm", { from: statusLabel(application.status), to: statusLabel(next) }))) return;
    setOverrideSaving(true);
    const result = await updateApplicationStatus(application.id, next);
    setOverrideSaving(false);
    if (result.error) {
      alert(result.error);
      return;
    }
    setOverrideOpen(false);
    router.refresh();
  };

  const handleAction = async (newStatus: string) => {
    setLoading(true);
    const result = await updateApplicationStatus(application.id, newStatus);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
  };

  const handleRevision = async () => {
    if (revisionIndexes.length === 0) { alert(t("selectAtLeastOneDeliverable")); return; }
    const links = application.submission_links || [];
    const selectedLabels = revisionIndexes.map((i) => links[i]?.label || links[i]?.type || `Deliverable ${i + 1}`);
    setLoading(true);
    const result = await updateApplicationStatus(application.id, "revision_needed", undefined, undefined, undefined, revisionNote, selectedLabels);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
    setShowRevision(false);
  };

  const toggleRevisionIndex = (idx: number) => {
    setRevisionIndexes((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
  };

  const handleApprove = async () => {
    setLoading(true);
    // Barter: no rate at all, so final_agreed_rate stays null and nothing
    // reaches escrow or the payouts queue.
    const amount = isBarter ? undefined : payAmount ? parseInt(payAmount) : undefined;
    const result = await updateApplicationStatus(application.id, "approved", undefined, amount, payNote || undefined);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
    setShowReview(false);
  };

  // One click, no panel: parking an applicant needs no rate and no reason,
  // and asking for either would make the quick decision slow. The creator
  // gets the "shortlisted" email and notification from the action itself.
  const handleHold = async () => {
    setLoading(true);
    const result = await updateApplicationStatus(application.id, "on_hold");
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
    setShowReview(false);
    setShowReject(false);
  };

  const handleReject = async () => {
    setLoading(true);
    const result = await updateApplicationStatus(application.id, "rejected", reason || undefined);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
    setShowReject(false);
  };

  const btnBase = "inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border";

  return (
    <div className="px-6 py-4">
      {/* Summary Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/dashboard/influencers/${application.influencer_id}`}>
            <Avatar src={inf?.profile_photo_url} name={inf?.full_name} size="md" shape="rounded" className="hover:border-indigo-400 transition-colors" />
          </Link>
          <div className="min-w-0">
            <Link href={`/dashboard/influencers/${application.influencer_id}`} className="text-sm font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors truncate block">
              {inf?.full_name || t("unknown")}
            </Link>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {match && (
                <MatchBadge
                  result={match}
                  label={t("matchPercent", { percent: match.percent ?? 0 })}
                  whyLabel={t("matchWhy")}
                />
              )}
              {match?.belowFollowerMin && followerMin ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                  {t("underMinBadge", { min: formatCount(followerMin) })}
                </span>
              ) : null}
              {inf?.instagram_handle && <InstagramLink handle={inf.instagram_handle} className="text-xs text-gray-400" />}
              <span className="text-xs text-gray-400">{t("followersMeta", { count: formatCount(inf?.followers_count ?? null) })}</span>
              {inf?.engagement_rate != null && <span className="text-xs text-gray-400">{t("engagementRateMeta", { rate: inf.engagement_rate })}</span>}
              {application.proposed_rate != null && <span className="text-xs font-semibold text-indigo-500">{t("proposedRate", { amount: application.proposed_rate.toLocaleString() })}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {application.final_agreed_rate != null && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mr-1">₹{application.final_agreed_rate.toLocaleString()}</span>
          )}
          {isAdmin ? (
            overrideOpen ? (
              <select
                autoFocus
                value={application.status}
                disabled={overrideSaving}
                onBlur={() => setOverrideOpen(false)}
                onChange={(e) => handleOverride(e.target.value)}
                className={`inline-flex text-[10px] font-semibold rounded-full px-2.5 py-0.5 border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:opacity-60 ${st.bg}`}
              >
                {Object.keys(statusConfig).map((k) => (
                  <option key={k} value={k} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">{t(`status.${k}`)}</option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                title={t("clickToOverrideStatus")}
                onClick={() => setOverrideOpen(true)}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-shadow ${st.bg}`}
              >
                {t(`status.${stKey}`)}
                <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )
          ) : (
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${st.bg}`}>{t(`status.${stKey}`)}</span>
          )}

          {isAdmin && (
            <div className="flex items-center gap-1.5 ml-2">
              {/* Approve opens the review panel (rate + note), which is why
                  it only shows while the application is still undecided —
                  on_hold included, since parking one is explicitly not a
                  decision. */}
              {(application.status === "pending" || application.status === "on_hold") && (
                <button onClick={() => { setShowReview(!showReview); setShowReject(false); }} disabled={loading}
                  className={`${btnBase} bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {t("approve")}
                </button>
              )}

              {/* On hold is ALWAYS available, which is the point of it: an
                  applicant can be parked at any stage, including one already
                  approved or rejected that is being reconsidered. Hidden only
                  when the row is already on hold (nothing to do) or the
                  creator withdrew (their call, not ours). */}
              {!["on_hold", "withdrawn"].includes(application.status) && (
                <button onClick={handleHold} disabled={loading} title={t("onHoldHint")}
                  className={`${btnBase} bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800 hover:bg-violet-100`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {t("onHold")}
                </button>
              )}

              {/* Icon only. The label was the widest thing in a row that
                  already carries a badge, a status dropdown and up to three
                  other controls; the accessible name stays on title +
                  aria-label so it is still announced and still hoverable. */}
              {!["rejected", "withdrawn"].includes(application.status) && (
                <button onClick={() => { setShowReject(!showReject); setShowReview(false); }} disabled={loading}
                  title={t("reject")} aria-label={t("reject")}
                  className={`${btnBase} px-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ====== REVIEW PANEL ====== */}
      {showReview && application.status === "pending" && (
        <div className="mt-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden">
          {/* Section 1: Submitted Profile (mirrors the RGossips apply form) */}
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("submittedProfile")}</h4>
              <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">{t("autoFilledFromInfluencer")}</span>
            </div>

            {/* Profile fields — same layout as ApplyCampaignForm */}
            <div className="space-y-2">
              <ProfileField icon="user" label={t("fullName")} value={inf?.full_name || t("notSet")} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ProfileField icon="mail" label={t("email")} value={inf?.email || t("notSet")} />
                <ProfileField icon="phone" label={t("phone")} value={phone ? (phone.startsWith("+") ? phone : `+${phone}`) : t("notSet")} />
              </div>
              <ProfileField
                icon="instagram"
                label={t("instagram")}
                value={inf?.instagram_handle ? <InstagramLink handle={inf.instagram_handle} /> : t("notConnected")}
              />
              <div className="grid grid-cols-2 gap-2">
                <ProfileField icon="users" label={t("followers")} value={formatCount(inf?.followers_count ?? null)} />
                <ProfileField icon="activity" label={t("engagementRate")} value={inf?.engagement_rate ? `${inf.engagement_rate}%` : "—"} />
              </div>
            </div>

            {/* Media Kit */}
            {inf?.media_kit_published && inf?.instagram_handle && (
              <a href={`https://rgossips.com/kit/${inf.instagram_handle}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 border border-purple-100 dark:border-purple-900/30 bg-purple-50/50 dark:bg-purple-900/10 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors group">
                <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:scale-105 transition-transform">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">{t("viewMediaKit")}</p>
                  <p className="text-[10px] text-gray-400 truncate">rgossips.com/kit/{inf.instagram_handle}</p>
                </div>
                <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">{t("published")}</span>
              </a>
            )}

            {/* Categories */}
            {inf?.categories && inf.categories.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t("categories")}</p>
                <div className="flex flex-wrap gap-1">
                  {inf.categories.map((cat) => (
                    <span key={cat} className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold">{cat}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Bio */}
            {inf?.bio && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">{t("bio")}</p>
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{inf.bio}</p>
              </div>
            )}
          </div>

          {/* Barter: no money changes hands, so the rate, the payment decision
              and the escrow note below are all skipped. */}
          {isBarter && (
            <div className="px-5 pb-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
                <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <div className="text-[12px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  <p className="font-semibold mb-1">{t("barterCampaign")}</p>
                  <p className="text-amber-600 dark:text-amber-400">{t("barterNoPaymentNote")}</p>
                </div>
              </div>
            </div>
          )}

          {/* Section 2: Proposed Rate */}
          {!isBarter && (
          <div className="px-5 pb-4">
            <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t("influencersProposedRate")}</h4>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {application.proposed_rate ? `₹${application.proposed_rate.toLocaleString()}` : t("notSpecified")}
              </p>
              {budgetPerInfluencer > 0 && (
                <p className="text-[11px] text-gray-400 mt-1">{t("campaignBudgetPerInfluencer", { amount: budgetPerInfluencer.toLocaleString() })}</p>
              )}
            </div>
          </div>
          )}

          {/* Section 3: Admin Payment Decision */}
          {!isBarter && (
          <div className="px-5 pb-4 space-y-3">
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t("yourPaymentDecision")}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("approvedAmount")}</label>
                  <input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("noteOptional")}</label>
                  <input type="text" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder={t("notePlaceholder")}
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Section 4: Escrow Info */}
          {!isBarter && (
          <div className="px-5 pb-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div className="text-[12px] text-blue-700 dark:text-blue-300 leading-relaxed">
                <p className="font-semibold mb-1">{t("escrowPayment")}</p>
                <ul className="space-y-0.5 text-blue-600 dark:text-blue-400">
                  <li>{t("escrowHeldNote")}</li>
                  <li>{t("escrowTransferNote")}</li>
                  <li>{t("escrowRefundNote")}</li>
                </ul>
              </div>
            </div>
          </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 px-5 pb-5">
            <button onClick={handleApprove} disabled={loading || (!isBarter && (!payAmount || parseInt(payAmount) <= 0))}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors">
              {loading ? <ButtonSpinner /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
              {loading ? t("processing") : isBarter ? t("approveApplication") : t("approveAndHold", { amount: parseInt(payAmount || "0").toLocaleString() })}
            </button>
            <button onClick={() => setShowReview(false)} className="px-5 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* ====== SUBMISSION REVIEW (when influencer submits deliverables) ====== */}
      {/* Delivery — only for a campaign that actually ships or is collected.
          Hidden for pending/rejected rows: nothing moves until someone is in. */}
      {shippingMode !== "no" && !["rejected", "withdrawn"].includes(application.status) && (
        <FulfilmentPanel application={application} shippingMode={shippingMode} />
      )}

      {application.submission_links && application.submission_links.length > 0 && ["submitted", "revision_needed", "accepted", "live_submitted", "payment", "completed"].includes(application.status) && (
        <div className="mt-4 bg-purple-50/50 dark:bg-purple-900/10 rounded-2xl border border-purple-100 dark:border-purple-900/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-purple-100 dark:border-purple-800/30 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-900 dark:text-white">{application.status === "live_submitted" ? t("liveLinksForReview") : t("deliverableLinks")}</h4>
              <p className="text-[10px] text-gray-400">{application.status === "live_submitted" ? t("linksPostedLive", { count: application.submission_links.length }) : t("linksSubmitted", { count: application.submission_links.length })}</p>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {application.submission_links.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 transition-colors group">
                <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center text-purple-500 group-hover:scale-105 transition-transform shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors capitalize">{item.label || item.type || t("deliverableN", { n: i + 1 })}</p>
                  <p className="text-[10px] text-gray-400 truncate">{item.url}</p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold capitalize shrink-0">{item.type}</span>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </a>
            ))}
          </div>

          {/* Submitted: Accept / Need Revision / Reject */}
          {isAdmin && application.status === "submitted" && !showRevision && (
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <button onClick={() => handleAction("accepted")} disabled={loading}
                className={`${btnBase} bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100`}>
                {loading ? <ButtonSpinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                {t("acceptDeliverables")}
              </button>
              <button onClick={() => { setShowRevision(true); setShowReject(false); }} disabled={loading}
                className={`${btnBase} bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                {t("needRevision")}
              </button>
              <button onClick={() => { setShowReject(true); setShowRevision(false); }} disabled={loading}
                className={`${btnBase} bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                {t("reject")}
              </button>
            </div>
          )}

          {/* Live links submitted. A barter deal has no money in it, so there
              is nothing to release: approving the links IS the completion,
              and the next thing owed is the product, not a payout. A paid
              campaign still goes live_submitted -> payment -> completed. */}
          {isAdmin && application.status === "live_submitted" && !showRevision && (
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <button onClick={() => handleAction(isBarter ? "completed" : "payment")} disabled={loading}
                className={`${btnBase} ${
                  isBarter
                    ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100"
                    : "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                }`}>
                {loading ? <ButtonSpinner /> : isBarter ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                )}
                {isBarter ? t("approveLinks") : t("releasePayment")}
              </button>
              <button onClick={() => { setShowRevision(true); setShowReject(false); }} disabled={loading}
                className={`${btnBase} bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                {t("needRevision")}
              </button>
            </div>
          )}

          {/* Payment: Initiate Payment */}
          {application.status === "payment" && (
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <button onClick={() => handleAction("completed")} disabled={loading}
                className={`${btnBase} bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100`}>
                {loading ? <ButtonSpinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                {t("markAsCompleted")}
              </button>
            </div>
          )}

          {/* Revision Selection Panel */}
          {showRevision && ["submitted", "live_submitted"].includes(application.status) && application.submission_links && (
            <div className="px-4 pb-4 space-y-3">
              <div className="p-4 bg-orange-50 dark:bg-orange-900/10 rounded-xl border border-orange-100 dark:border-orange-900/30 space-y-3">
                <h4 className="text-xs font-semibold text-orange-700 dark:text-orange-300">{t("selectDeliverablesRevision")}</h4>
                <div className="space-y-2">
                  {application.submission_links.map((item, i) => {
                    const selected = revisionIndexes.includes(i);
                    return (
                      <button key={i} type="button" onClick={() => toggleRevisionIndex(i)}
                        className={`flex items-center gap-3 w-full p-3 rounded-xl text-left transition-all cursor-pointer border ${
                          selected
                            ? "bg-orange-100 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700"
                            : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-orange-200 dark:hover:border-orange-800"
                        }`}>
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                          selected ? "bg-orange-500 border-orange-500" : "border-gray-300 dark:border-gray-600"
                        }`}>
                          {selected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 capitalize">{item.label || item.type}</p>
                          <p className="text-[10px] text-gray-400 truncate">{item.url}</p>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 font-semibold capitalize shrink-0">{item.type}</span>
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-orange-700 dark:text-orange-300 mb-1.5">{t("revisionNote")}</label>
                  <textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} rows={2}
                    placeholder={t("revisionNotePlaceholder")}
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleRevision} disabled={loading || revisionIndexes.length === 0}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:bg-orange-300 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors">
                    {loading ? <ButtonSpinner /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                    {t("sendForRevision", { count: revisionIndexes.length })}
                  </button>
                  <button onClick={() => { setShowRevision(false); setRevisionIndexes([]); setRevisionNote(""); }}
                    className="px-5 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
                    {t("cancel")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reject Panel — works for all rejectable states */}
      {showReject && ["pending", "approved", "submitted", "revision_needed"].includes(application.status) && (
        <div className="mt-3 flex items-center gap-2">
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("rejectionReasonPlaceholder")}
            className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500" />
          <button onClick={handleReject} disabled={loading} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
            {loading ? <ButtonSpinner /> : t("confirmReject")}
          </button>
          <button onClick={() => setShowReject(false)} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs cursor-pointer">{t("cancel")}</button>
        </div>
      )}

      {/* Revision details */}
      {application.status === "revision_needed" && application.rejection_reason && (() => {
        let revData: { note?: string; links?: string[] } = {};
        try { revData = JSON.parse(application.rejection_reason); } catch {}
        if (!revData.note && !revData.links?.length) return null;
        return (
          <div className="mt-3 p-4 rounded-xl bg-orange-50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/30 space-y-2">
            <h4 className="text-xs font-semibold text-orange-700 dark:text-orange-300 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {t("revisionRequested")}
            </h4>
            {revData.note && <p className="text-xs text-orange-600 dark:text-orange-400">{revData.note}</p>}
            {revData.links && revData.links.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider">{t("linksToRevise")}</p>
                {revData.links.map((url, i) => {
                  const match = application.submission_links?.find((s) => s.url === url);
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400">
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
                      <span className="font-semibold capitalize">{match?.label || match?.type || t("link")}</span>
                      <span className="text-orange-400 truncate">{url}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Escrow info for approved/submitted */}
      {["approved", "submitted", "revision_needed"].includes(application.status) && application.final_agreed_rate != null && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30">
          <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          <span className="text-xs text-indigo-700 dark:text-indigo-300">
            {t.rich("heldInEscrow", { amount: application.final_agreed_rate.toLocaleString(), b: (c) => <span className="font-semibold">{c}</span> })}
          </span>
        </div>
      )}

      {/* Accepted — waiting for live links */}
      {application.status === "accepted" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
          <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-xs text-emerald-700 dark:text-emerald-300">
            {t("deliverablesAcceptedWaiting")}
          </span>
        </div>
      )}

      {/* Live links submitted — review */}
      {application.status === "live_submitted" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-cyan-50 dark:bg-cyan-900/10 border border-cyan-100 dark:border-cyan-900/30">
          <svg className="w-4 h-4 text-cyan-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
          <span className="text-xs text-cyan-700 dark:text-cyan-300">
            {t("liveLinksSubmittedVerify")}
          </span>
        </div>
      )}

      {/* Payment processing */}
      {application.status === "payment" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {application.final_agreed_rate
              ? t("paymentReleasedWithAmount", { amount: application.final_agreed_rate.toLocaleString() })
              : t("paymentReleased")}
          </span>
        </div>
      )}

      {/* Rejection reason */}
      {application.rejection_reason && application.status === "rejected" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
          <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-xs text-red-600 dark:text-red-400">{t("rejectedReason", { reason: application.rejection_reason })}</span>
        </div>
      )}

      {/* Date */}
      <p className="text-[11px] text-gray-400 mt-1.5">
        {t("appliedDate", { date: new Date(application.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) })}
      </p>
    </div>
  );
}

const iconPaths: Record<string, string> = {
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  mail: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  phone: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  instagram: "M16 4H8a4 4 0 00-4 4v8a4 4 0 004 4h8a4 4 0 004-4V8a4 4 0 00-4-4zm-4 11a3 3 0 110-6 3 3 0 010 6zm4.5-7.5a1 1 0 110-2 1 1 0 010 2z",
  users: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  activity: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
};

const iconColors: Record<string, string> = {
  user: "text-purple-500", mail: "text-pink-500", phone: "text-blue-500",
  instagram: "text-pink-500", users: "text-purple-500", activity: "text-emerald-500",
};

function ProfileField({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
      <svg className={`w-4 h-4 shrink-0 ${iconColors[icon] || "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPaths[icon] || ""} />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase">{label}</p>
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">{value}</div>
      </div>
    </div>
  );
}
