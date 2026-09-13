import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { RefreshButton } from "@/components/refresh-button";
import { Avatar } from "@/components/avatar";
import { sanitizeSearchTerm } from "@/lib/validation";
import { logError } from "@/lib/log";
import {
  BILLING_CYCLES,
  PLAN_BADGE_CLASS,
  PLAN_LABEL,
  SUBSCRIPTION_TIERS,
  VALID_BILLING_CYCLES,
  VALID_PLAN_KEYS,
} from "@/lib/subscription-plans";

const PAGE_SIZE = 25;
// PostgREST caps a page at 1000 rows — the stats scan pages past it.
const STATS_PAGE = 1000;

// Only starter/pro/elite are entitlements (see subscription-plans.ts); the
// legacy "trial"/"free" defaults are not subscriptions and are excluded.
const PAID_TIERS = SUBSCRIPTION_TIERS.map((t) => t.key as string);

// payment_gateway values written by the consumer app's webhooks, plus the
// "admin" marker updateInfluencerPlan() writes for a comped plan.
const SOURCES = ["razorpay", "apple_iap", "google_play", "admin", "stripe"] as const;

type SubscriberRow = {
  influencer_id: string;
  full_name: string | null;
  username: string | null;
  instagram_handle: string | null;
  profile_photo_url: string | null;
  email: string | null;
  subscription_plan: string;
  billing_cycle: string | null;
  payment_gateway: string | null;
  auto_renew: boolean | null;
  plan_expires_at: string | null;
  subscription_cancelled_at: string | null;
  razorpay_subscription_id: string | null;
  created_at: string | null;
};

type IapRow = {
  user_id: string;
  status: string | null;
  expires_at: string | null;
  auto_renewing: boolean | null;
};

type Stats = {
  total: number;
  byPlan: Record<string, { total: number; monthly: number; annual: number }>;
};

type Admin = ReturnType<typeof createAdminClient>;

async function loadStats(admin: Admin): Promise<Stats> {
  const stats: Stats = {
    total: 0,
    byPlan: Object.fromEntries(PAID_TIERS.map((k) => [k, { total: 0, monthly: 0, annual: 0 }])),
  };
  for (let from = 0; ; from += STATS_PAGE) {
    const { data, error } = await admin
      .from("influencer_profiles")
      .select("subscription_plan, billing_cycle")
      .in("subscription_plan", PAID_TIERS)
      .order("influencer_id")
      .range(from, from + STATS_PAGE - 1);
    if (error) {
      logError("subscriptions-stats", error, { from });
      break;
    }
    for (const row of data || []) {
      const bucket = stats.byPlan[row.subscription_plan];
      if (!bucket) continue;
      stats.total++;
      bucket.total++;
      if (row.billing_cycle === "monthly") bucket.monthly++;
      else if (row.billing_cycle === "annual") bucket.annual++;
    }
    if (!data || data.length < STATS_PAGE) break;
  }
  return stats;
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const t = await getTranslations("DashboardSubscriptions");
  const params = await searchParams;
  const admin = createAdminClient();

  const searchTerm = sanitizeSearchTerm(params.search);
  const plan = params.plan && VALID_PLAN_KEYS.has(params.plan) ? params.plan : "";
  const cycle = params.cycle && VALID_BILLING_CYCLES.has(params.cycle) ? params.cycle : "";
  const source = params.source && ((SOURCES as readonly string[]).includes(params.source) || params.source === "none") ? params.source : "";
  const requestedPage = Math.max(1, parseInt(params.page || "1", 10) || 1);

  // auto_renew / plan_expires_at / subscription_cancelled_at come from
  // RS_Gossips migration 069. Until it's applied, selecting them fails the
  // whole query (42703) and the page showed "Couldn't load subscribers" — so
  // the list falls back to the base columns and simply omits the
  // "auto-renew off" note.
  const BASE_COLS =
    "influencer_id, full_name, username, instagram_handle, profile_photo_url, email, subscription_plan, billing_cycle, payment_gateway, razorpay_subscription_id, created_at";
  const LIFECYCLE_COLS = ", auto_renew, plan_expires_at, subscription_cancelled_at";

  const buildQuery = (page: number, withLifecycle: boolean) => {
    const from = (page - 1) * PAGE_SIZE;
    let q = admin
      .from("influencer_profiles")
      .select(withLifecycle ? BASE_COLS + LIFECYCLE_COLS : BASE_COLS, { count: "exact" })
      .in("subscription_plan", plan ? [plan] : PAID_TIERS)
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (cycle) q = q.eq("billing_cycle", cycle);
    if (source === "none") q = q.is("payment_gateway", null);
    else if (source) q = q.eq("payment_gateway", source);
    // Sanitized above — this hand-built .or() runs on the service-role client.
    if (searchTerm) {
      q = q.or(
        `full_name.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%,instagram_handle.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`,
      );
    }
    return q;
  };

  const [stats, attempt] = await Promise.all([loadStats(admin), buildQuery(requestedPage, true)]);
  // 42703 = undefined column → migration 069 not applied yet. Expected, not
  // an incident, so it is retried quietly rather than logged on every view.
  const lifecycleLive = attempt.error?.code !== "42703";
  const firstPage = lifecycleLive ? attempt : await buildQuery(requestedPage, false);
  const total = firstPage.count ?? 0;
  // FilterBar keeps ?page= when a filter narrows the set — land on the last
  // real page instead of an empty table.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = !firstPage.error && total > 0 && requestedPage > lastPage ? lastPage : requestedPage;
  const { data, error } = page === requestedPage ? firstPage : await buildQuery(page, lifecycleLive);
  if (error) logError("subscriptions-list", error, { plan, cycle, source });
  // The column list is chosen at runtime, so supabase-js can't infer the row
  // shape; lifecycle fields are simply undefined when 069 isn't applied.
  const rows = (data || []) as unknown as SubscriberRow[];

  const ids = rows.map((r) => r.influencer_id);

  // Phone lives on auth.users, not the profile. One page = at most 25 lookups.
  const phoneMap = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const { data: u } = await admin.auth.admin.getUserById(id);
        if (u?.user?.phone) phoneMap.set(id, u.user.phone);
      } catch {
        // Non-fatal — the cell shows "—".
      }
    }),
  );

  // App-store subscriptions carry a real status + expiry in iap_subscriptions
  // (RS_Gossips migration 064). Gateway subscriptions (Razorpay/Stripe) now
  // carry theirs on the profile itself — auto_renew / plan_expires_at, added
  // in migration 069 — so a cancelled-but-still-paid subscription is visible
  // here rather than only inside the Razorpay dashboard.
  const iapMap = new Map<string, IapRow>();
  const iapIds = rows.filter((r) => r.payment_gateway === "apple_iap" || r.payment_gateway === "google_play").map((r) => r.influencer_id);
  if (iapIds.length > 0) {
    const { data: iap, error: iapError } = await admin
      .from("iap_subscriptions")
      .select("user_id, status, expires_at, auto_renewing")
      .in("user_id", iapIds)
      .order("updated_at", { ascending: false });
    if (iapError) logError("subscriptions-iap", iapError);
    for (const r of (iap || []) as IapRow[]) {
      if (!iapMap.has(r.user_id)) iapMap.set(r.user_id, r); // newest wins
    }
  }

  const sourceLabel = (g: string | null) => (g && (SOURCES as readonly string[]).includes(g) ? t(`source.${g}`) : t("source.none"));
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

  const filterFields = [
    { name: "search", label: t("filter.search"), type: "text" as const, placeholder: t("filter.searchPlaceholder") },
    { name: "plan", label: t("filter.allPlans"), type: "select" as const, options: SUBSCRIPTION_TIERS.map((tier) => ({ label: tier.label, value: tier.key })) },
    { name: "cycle", label: t("filter.allCycles"), type: "select" as const, options: BILLING_CYCLES.map((c) => ({ label: t(`cycle.${c}`), value: c })) },
    { name: "source", label: t("filter.allSources"), type: "select" as const, options: [...SOURCES.map((s) => ({ label: t(`source.${s}`), value: s })), { label: t("source.none"), value: "none" }] },
  ];

  const th = "text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">{t("subtitle")}</p>
        </div>
        <RefreshButton />
      </div>

      {/* Stat cards — each links to its tier filter */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard href="/dashboard/subscriptions" label={t("stats.total")} value={stats.total} active={!plan} />
        {SUBSCRIPTION_TIERS.map((tier) => {
          const s = stats.byPlan[tier.key];
          return (
            <StatCard
              key={tier.key}
              href={`/dashboard/subscriptions?plan=${tier.key}`}
              label={tier.label}
              value={s.total}
              sub={t("stats.cycleSplit", { monthly: s.monthly, annual: s.annual })}
              active={plan === tier.key}
            />
          );
        })}
      </div>

      <FilterBar fields={filterFields} />

      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t("starterNote")}</p>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
          {t("failedToLoad")}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                <th className={th}>{t("table.creator")}</th>
                <th className={th}>{t("table.contact")}</th>
                <th className={th}>{t("table.plan")}</th>
                <th className={th}>{t("table.billing")}</th>
                <th className={th}>{t("table.source")}</th>
                <th className={th}>{t("table.joined")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.length > 0 ? (
                rows.map((r) => {
                  const tier = SUBSCRIPTION_TIERS.find((x) => x.key === r.subscription_plan);
                  const cycleKey = r.billing_cycle && VALID_BILLING_CYCLES.has(r.billing_cycle) ? (r.billing_cycle as (typeof BILLING_CYCLES)[number]) : null;
                  const phone = phoneMap.get(r.influencer_id);
                  const iap = iapMap.get(r.influencer_id);
                  const handle = r.instagram_handle || r.username;
                  return (
                    <tr key={r.influencer_id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-6 py-3.5">
                        <Link href={`/dashboard/influencers/${r.influencer_id}`} className="flex items-center gap-3 group">
                          <Avatar src={r.profile_photo_url} name={r.full_name} size="sm" shape="circle" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
                              {r.full_name || t("unnamed")}
                            </p>
                            {handle && <p className="text-xs text-gray-400 truncate">@{handle}</p>}
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-3.5">
                        <p className="text-xs text-gray-600 dark:text-gray-300">{r.email || "—"}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{phone ? (phone.startsWith("+") ? phone : `+${phone}`) : "—"}</p>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${PLAN_BADGE_CLASS[r.subscription_plan] || ""}`}>
                          {PLAN_LABEL[r.subscription_plan] || r.subscription_plan}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        {cycleKey ? (
                          <>
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{t(`cycle.${cycleKey}`)}</p>
                            {tier && <p className="text-xs text-gray-400 mt-0.5">{tier.pricing[cycleKey]}</p>}
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">{t("cycle.unknown")}</span>
                        )}
                      </td>
                      <td className="px-6 py-3.5">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{sourceLabel(r.payment_gateway)}</p>
                        {iap ? (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {t("iapStatus", {
                              status: iap.status || "unknown",
                              date: fmtDate(iap.expires_at),
                              renewing: iap.auto_renewing && iap.status === "active" ? "yes" : "no",
                            })}
                          </p>
                        ) : null}
                        {!iap && r.auto_renew === false ? (
                          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                            {r.plan_expires_at
                              ? t("autoRenewOffUntil", { date: fmtDate(r.plan_expires_at) })
                              : t("autoRenewOff")}
                          </p>
                        ) : null}
                        {!iap && r.payment_gateway === "razorpay" && r.razorpay_subscription_id ? (
                          <p className="text-[11px] font-mono text-gray-400 mt-0.5">{r.razorpay_subscription_id}</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-sm text-gray-400 dark:text-gray-500">
                    {searchTerm || plan || cycle || source ? t("noMatches") : t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination basePath="/dashboard/subscriptions" pageParam="page" currentParams={params} page={page} perPage={PAGE_SIZE} total={total} />
    </div>
  );
}

function StatCard({ href, label, value, sub, active }: { href: string; label: string; value: number; sub?: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`block rounded-2xl border p-5 transition-colors ${
        active
          ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-900/20"
          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-200 dark:hover:border-indigo-800"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value.toLocaleString("en-IN")}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </Link>
  );
}
