import Link from "next/link";
import { getTranslations } from "next-intl/server";

// Statuses that still need somebody to do something. Must match
// OPEN_STATUSES on the applications page, or the headline here and the
// first tab there would disagree about the same campaign.
const OPEN_STATUSES = new Set([
  "pending",
  "on_hold",
  "approved",
  "submitted",
  "revision_needed",
  "accepted",
  "live_submitted",
  "payment",
]);

function Kpi({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  /** Where this number lives in full. Omitted when there is nothing to show. */
  href?: string;
  tone?: "warn";
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{label}</p>
      <p
        className={`mt-0.5 text-xl font-bold ${
          tone === "warn" && value > 0
            ? "text-amber-600 dark:text-amber-400"
            : "text-gray-900 dark:text-white"
        }`}
      >
        {value}
      </p>
    </>
  );
  // A zero is not a destination. Linking it would land on a tab that is not
  // even rendered — the list hides empty statuses — so the card would look
  // broken for having been honest about there being nothing there.
  if (!href || value === 0) {
    return <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800">{body}</div>;
  }
  return (
    <Link
      href={href}
      className="rounded-xl border border-gray-200 px-4 py-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-gray-800 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"
    >
      {body}
    </Link>
  );
}

/**
 * The applications headline on the campaign detail page.
 *
 * Four numbers and a way through to the list. Deliberately not a preview of
 * the first few rows: a partial list invites deciding from it, and the
 * decisions worth making need the ranking, the brief and the filters that
 * live on the full page.
 */
export async function ApplicationsSummary({
  campaignId,
  applications,
}: {
  campaignId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applications: any[];
}) {
  const t = await getTranslations("DashboardCampaignsIdApplications");
  const base = `/dashboard/campaigns/${campaignId}/applications`;
  const total = applications.length;
  const needsAction = applications.filter((a) => OPEN_STATUSES.has(String(a.status))).length;
  const approved = applications.filter((a) => String(a.status) === "approved").length;
  const completed = applications.filter((a) => String(a.status) === "completed").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-gray-100 px-6 py-4 dark:border-gray-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("applications")}</h2>
        <Link
          href={`/dashboard/campaigns/${campaignId}/applications`}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
        >
          {t("viewAllApplications")} →
        </Link>
      </div>

      {total === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-gray-400 dark:text-gray-500">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-6 lg:grid-cols-4">
          <Kpi label={t("kpiTotal")} value={total} href={`${base}?tab=all`} />
          {/* "Needs action" is the list's default tab, so it carries no
              param — the URL an admin shares is then the same one the link
              in the header produces. */}
          <Kpi label={t("kpiNeedsAction")} value={needsAction} href={base} tone="warn" />
          <Kpi label={t("kpiApproved")} value={approved} href={`${base}?tab=approved`} />
          <Kpi label={t("kpiCompleted")} value={completed} href={`${base}?tab=completed`} />
        </div>
      )}
    </div>
  );
}
