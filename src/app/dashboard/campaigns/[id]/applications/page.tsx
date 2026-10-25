import Link from "next/link";
import { FilterSubmit } from "@/components/filter-submit";
import { Pagination } from "@/components/pagination";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { normalizeShippingMode, type ShippingMode } from "@/lib/barter-fulfilment";
import { ApplicationsList } from "../applications";
import { loadCampaignApplications, countByStatus } from "../load-applications";

export const dynamic = "force-dynamic";

// One campaign has 169 applications and the list renders a rich row for
// each — match ranking, delivery state, deliverable links, the action
// buttons. Rendering all of them was the page's own contribution to how
// slow it feels.
const PER_PAGE = 25;

// The order the tabs appear in, which is the order an application moves
// through. `rejected`/`withdrawn` sit at the end because they are outcomes,
// not steps.
const TAB_ORDER = [
  "pending",
  "on_hold",
  "approved",
  "submitted",
  "revision_needed",
  "accepted",
  "live_submitted",
  "payment",
  "completed",
  "rejected",
  "withdrawn",
] as const;

// Statuses that still need somebody to do something, which is what "Open"
// means on the first tab. Anything settled or abandoned is excluded.
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

export default async function CampaignApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations("DashboardCampaignsIdApplications");

  // Read-only page, but it carries creator emails, phones and home
  // addresses, so it is gated like the rest of the dashboard rather than
  // left open because "it is only a list".
  if (!(await isAdminOrAbove())) redirect(`/dashboard/campaigns/${id}`);

  const supabase = createAdminClient();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("campaign_id", id)
    .single();
  if (error || !campaign) return notFound();

  const { applications, phones } = await loadCampaignApplications(supabase, id);
  const counts = countByStatus(applications);

  // The brief lives in the description trailer. Six characters, not five —
  // slicing at +5 leaves a stray newline that JSON.parse happens to
  // tolerate, which is why the bug survives elsewhere in this codebase.
  const SEP = "\n\n---\n";
  let shippingMode: ShippingMode = "no";
  let engagementRate: number | null = null;
  let targetGender: string[] | null = null;
  const desc = String(campaign.description || "");
  const at = desc.indexOf(SEP);
  const json = at !== -1 ? desc.slice(at + SEP.length) : desc.trim().startsWith("{") ? desc : "";
  if (json) {
    try {
      const meta = JSON.parse(json);
      shippingMode = normalizeShippingMode(meta.shipping_required);
      engagementRate = meta.min_engagement_rate || null;
      targetGender = Array.isArray(meta.target_gender) ? meta.target_gender : null;
    } catch {
      // A malformed trailer means no brief to rank against, not a dead page.
    }
  }

  const tab = typeof sp.tab === "string" ? sp.tab : "open";
  const query = typeof sp.q === "string" ? sp.q.trim() : "";
  const inTab =
    tab === "all"
      ? applications
      : tab === "open"
        ? applications.filter((a) => OPEN_STATUSES.has(String(a.status)))
        : applications.filter((a) => String(a.status) === tab);

  // Name, handle and email — the three things an admin actually has when
  // they are looking for someone. Matched in memory rather than through
  // PostgREST: the page already holds every application for this campaign,
  // so a query would be a round trip for data in hand, and it would have to
  // reach across the influencer_profiles embed AND the invitation-backed
  // rows that have no profile row at all.
  const needle = query.toLowerCase();
  const visible = needle
    ? inTab.filter((a) => {
        const p2 = a.influencer_profiles || {};
        return `${p2.full_name || ""} ${p2.username || ""} ${p2.instagram_handle || ""} ${p2.email || ""}`
          .toLowerCase()
          .includes(needle);
      })
    : inTab;

  // Paged AFTER the tab and the search, so the count beside the search
  // describes the whole match and not just the slice on screen.
  const pageNum = Math.max(1, Number(sp.page) || 1);
  const paged = visible.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE);

  const openCount = applications.filter((a) => OPEN_STATUSES.has(String(a.status))).length;
  const tabs = [
    { id: "open", label: t("tabs.open"), count: openCount },
    { id: "all", label: t("tabs.all"), count: applications.length },
    // A status with nobody in it is left out: eleven tabs of which nine read
    // zero is a worse way to find the two that matter.
    ...TAB_ORDER.filter((s) => (counts[s] || 0) > 0).map((s) => ({
      id: s as string,
      label: t(`status.${s}`),
      count: counts[s],
    })),
  ];

  const href = (id2: string) => {
    const q = new URLSearchParams();
    if (id2 !== "open") q.set("tab", id2);
    // Carried across tabs on purpose: searching for someone and then
    // checking another status is one task, not two.
    if (query) q.set("q", query);
    // Deliberately NOT carrying `page`: switching tab is a new list, and
    // page 3 of the old one is usually past the end of the new one.
    const qs = q.toString();
    return `/dashboard/campaigns/${id}/applications${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/campaigns/${id}`}
            className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            ← {campaign.title || t("untitledCampaign")}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{t("applications")}</h1>
        </div>
      </div>

      {/* Status tabs, the same shape as the outreach tracker's stage tiles —
          the count is what an admin reads first, so it stays visible rather
          than hiding inside a dropdown. Scrolls on a phone; the negative
          margin and padding give the focus ring somewhere to live, because
          `overflow-x: auto` forces `overflow-y` to compute as auto too. */}
      <div className="-mx-1 overflow-x-auto px-1 py-1">
        <div className="flex min-w-max gap-2 md:grid md:min-w-0 md:grid-cols-4 lg:grid-cols-6">
          {tabs.map((x) => {
            const active = x.id === tab || (tab === "open" && x.id === "open");
            return (
              <Link
                key={x.id}
                href={href(x.id)}
                className={`rounded-xl border px-4 py-3 transition-colors ${
                  active
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/40"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                }`}
              >
                <p className="whitespace-nowrap text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                  {x.label}
                </p>
                <p className="mt-0.5 text-xl font-bold text-gray-900 dark:text-white">{x.count}</p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* A plain GET form, like the tabs are plain links: every view stays
          a shareable URL, the back button behaves, and it needs no
          JavaScript. The tab rides along in a hidden field so searching
          does not silently throw you back to "Needs action". */}
      <form method="GET" className="flex flex-wrap items-center gap-2">
        {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
        <div className="relative min-w-0 flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>
        <FilterSubmit
          label={t("searchAction")}
          pendingLabel={t("searchAction")}
          className="h-10 shrink-0 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500"
        />
        {query && (
          <Link
            href={tab === "open" ? `/dashboard/campaigns/${id}/applications` : `/dashboard/campaigns/${id}/applications?tab=${tab}`}
            className="h-10 shrink-0 cursor-pointer rounded-xl border border-gray-200 px-3 text-sm font-medium leading-10 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("searchClear")}
          </Link>
        )}
      </form>

      {/* The tab counts above stay UNFILTERED on purpose — they answer "how
          many are in each status", which is still true while a search is
          running, and they are how you notice the person you want is
          sitting under a different tab. This line is what the search did. */}
      {query && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("searchResults", { shown: visible.length, total: inTab.length, query })}
        </p>
      )}

      {/* The list itself is unchanged — it already carries the match
          ranking, the off-brief filter, bulk reject and every per-row
          action. Moving it here rather than rebuilding it as a plain table
          keeps all of that working. */}
      <ApplicationsList
        campaignId={campaign.campaign_id}
        applications={paged}
        budgetPerInfluencer={campaign.budget_per_influencer || 0}
        campaignType={campaign.campaign_type || "barter"}
        shippingMode={shippingMode}
        phones={phones}
        targeting={{
          categories: campaign.target_categories || null,
          cities: campaign.target_cities || null,
          followerMin: campaign.target_follower_min,
          followerMax: campaign.target_follower_max,
          gender: targetGender,
          minEngagementRate: engagementRate,
        }}
      />

      {/* The shared control: <Link>s only, so it adds no client JS and
          keeps the tab and the search in the URL as it pages. */}
      <Pagination
        basePath={`/dashboard/campaigns/${id}/applications`}
        pageParam="page"
        currentParams={{ tab: tab === "open" ? undefined : tab, q: query || undefined }}
        page={pageNum}
        perPage={PER_PAGE}
        total={visible.length}
      />
    </div>
  );
}
