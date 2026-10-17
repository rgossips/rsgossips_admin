import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { normalizeShippingMode, type ShippingMode } from "@/lib/barter-fulfilment";
import { ApplicationsList } from "../applications";
import { loadCampaignApplications, countByStatus } from "../load-applications";

export const dynamic = "force-dynamic";

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
  const visible =
    tab === "all"
      ? applications
      : tab === "open"
        ? applications.filter((a) => OPEN_STATUSES.has(String(a.status)))
        : applications.filter((a) => String(a.status) === tab);

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

      {/* The list itself is unchanged — it already carries the match
          ranking, the off-brief filter, bulk reject and every per-row
          action. Moving it here rather than rebuilding it as a plain table
          keeps all of that working. */}
      <ApplicationsList
        campaignId={campaign.campaign_id}
        applications={visible}
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
    </div>
  );
}
