import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { DashboardCharts } from "./charts";
import { MobileOpsHub } from "@/components/mobile/ops-hub";
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-plans";
import { logError } from "@/lib/log";

type StatCardSpec = {
  label: string;
  // null = the source isn't live yet; rendered as "—" rather than a fake 0.
  value: number | null;
  hint?: string;
  icon: string;
  // Full static class strings (bg + text, light + dark) — Tailwind can't see
  // classes assembled at runtime, so never build these from a color name.
  tint: string;
  href?: string;
};

// Compact horizontal stat: tinted icon, label over value, chevron on hover
// when it links somewhere. Module scope — see "Client component pitfalls".
function StatCard({ card, icon }: { card: StatCardSpec; icon: React.ReactNode }) {
  const body = (
    <>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${card.tint}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate">{card.label}</p>
        <p className="text-xl font-semibold leading-tight tabular-nums text-gray-900 dark:text-white mt-0.5">
          {card.value === null ? "—" : card.value.toLocaleString("en-IN")}
        </p>
        {card.hint && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate" title={card.hint}>{card.hint}</p>
        )}
      </div>
      {card.href && (
        <svg className="w-4 h-4 shrink-0 text-gray-300 dark:text-gray-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </>
  );
  const className =
    "group flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-3 transition-colors";
  return card.href ? (
    <Link href={card.href} className={`${className} hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50/60 dark:hover:bg-gray-800/40`}>{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

const IST_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

// IST calendar parts of a DB timestamp. Some tables return timestamps WITHOUT
// a zone ("2026-07-04T06:26:54") that are really UTC; `new Date()` would read
// those as server-local time, so mark them UTC first (same rule as the
// notification bell's parseTimestamp).
function istDateParts(ts: string): { year: string; month: string; day: string } {
  const iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`;
  const parts = IST_PARTS.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return { year: get("year"), month: get("month"), day: get("day") };
}

// "Today" for the admins means the India calendar day, not UTC — a UTC day
// would roll over at 5:30am IST. Returned as a UTC ISO string, which compares
// correctly against both timestamptz and UTC-wall-clock `timestamp` columns.
function startOfTodayIst(): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:30`).toISOString();
}

async function getStats(t: (key: string, values?: Record<string, string | number | Date>) => string) {
  const supabase = createAdminClient();
  const todayStart = startOfTodayIst();

  const [
    influencersTotal,
    brandsTotal,
    campaignsTotal,
    influencersPendingVerif,
    brandsPendingVerif,
    campaignsPendingApproval,
    influencersByMonth,
    brandsByMonth,
    campaignsByStatus,
    openDisputes,
    newInfluencersToday,
    subscriptionsTotal,
    newSubscriptionsToday,
    instagramStale,
    instagramNeverRefreshed,
  ] = await Promise.all([
    supabase.from("influencer_profiles").select("*", { count: "exact", head: true }),
    supabase.from("brand_profiles").select("*", { count: "exact", head: true }),
    supabase.from("campaigns").select("*", { count: "exact", head: true }),
    supabase
      .from("influencer_profiles")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", "pending"),
    supabase
      .from("brand_profiles")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", "pending"),
    supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      // Brand-published campaigns wait in "under_review" (set by the
      // RS_Gossips brand-campaigns edge fn). "pending" is not a campaign
      // status — counting it kept this stat at 0.
      .eq("status", "under_review"),
    supabase
      .from("influencer_profiles")
      .select("created_at")
      .gte("created_at", new Date(new Date().getFullYear(), 0, 1).toISOString()),
    supabase
      .from("brand_profiles")
      .select("created_at")
      .gte("created_at", new Date(new Date().getFullYear(), 0, 1).toISOString()),
    supabase.from("campaigns").select("status, created_at"),
    // High-priority disputes — surfaced at the top of the home page so
    // admins see them on every visit. Limit to 5 most recent.
    supabase
      .from("escrow_disputes_v")
      .select("application_id, campaign_title, brand_name, influencer_name, escrow_amount, dispute_opened_at, dispute_reason")
      .eq("escrow_status", "disputed")
      .order("dispute_opened_at", { ascending: false })
      .limit(5),
    supabase
      .from("influencer_profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart),
    // Same definition as the Subscriptions page: only starter/pro/elite are
    // entitlements; trial/free are column defaults.
    supabase
      .from("influencer_profiles")
      .select("*", { count: "exact", head: true })
      .in("subscription_plan", SUBSCRIPTION_TIERS.map((tier) => tier.key)),
    // Filled by a trigger (RS_Gossips migration 067). The profile row has no
    // "subscribed at" column, so this is the only source of "when".
    supabase
      .from("subscription_events")
      .select("*", { count: "exact", head: true })
      .eq("is_new_purchase", true)
      .gte("occurred_at", todayStart),
    // Instagram analytics health. refresh-instagram runs on login, so a
    // connected creator whose row has not refreshed in a week is either
    // inactive or failing to save. "Never refreshed" is the sharp signal:
    // that is how an emoji-truncation bug kept a creator's media kit empty
    // for days with nothing reported anywhere.
    supabase
      .from("influencer_profiles")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .not("instagram_access_token", "is", null)
      .or(`instagram_refreshed_at.is.null,instagram_refreshed_at.lt.${new Date(Date.now() - 7 * 86_400_000).toISOString()}`),
    supabase
      .from("influencer_profiles")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .not("instagram_access_token", "is", null)
      .is("instagram_refreshed_at", null)
      // Give a brand-new signup a day to get their first refresh in.
      .lt("created_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);

  // Migration 067 not applied yet → show "—", not a misleading 0. A head-only
  // count on a missing table comes back as { error: null, count: null } (the
  // 404 has no body to parse), so null count is the not-live signal too.
  const newSubscriptionsLive = !newSubscriptionsToday.error && newSubscriptionsToday.count !== null;
  if (newSubscriptionsToday.error) logError("dashboard-new-subscriptions", newSubscriptionsToday.error);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Signups bucketed by IST month AND day in one pass, so a month's bar always
  // equals the sum of its daily drill-down (double-click a month on the chart).
  // Previously bucketed with getMonth() on the server clock — UTC on Netlify —
  // which filed late-evening IST signups under the wrong day/month.
  const istYear = Number(istDateParts(new Date().toISOString()).year);
  const signupsDaily = months.map((_, m) =>
    Array.from({ length: new Date(Date.UTC(istYear, m + 1, 0)).getUTCDate() }, (_, d) => ({ day: String(d + 1), influencers: 0, brands: 0 })),
  );
  const tally = (rows: { created_at: string }[] | null, key: "influencers" | "brands") => {
    for (const r of rows || []) {
      const p = istDateParts(r.created_at);
      if (Number(p.year) !== istYear) continue;
      const slot = signupsDaily[Number(p.month) - 1]?.[Number(p.day) - 1];
      if (slot) slot[key]++;
    }
  };
  tally(influencersByMonth.data, "influencers");
  tally(brandsByMonth.data, "brands");
  const monthlySignups = months.map((month, m) => ({
    month,
    influencers: signupsDaily[m].reduce((n, d) => n + d.influencers, 0),
    brands: signupsDaily[m].reduce((n, d) => n + d.brands, 0),
  }));

  const campaignMonthly = months.map((month, i) => {
    const monthCampaigns = campaignsByStatus.data?.filter(
      (r) => new Date(r.created_at).getMonth() === i
    ) ?? [];
    return {
      month,
      completed: monthCampaigns.filter((c) => c.status === "completed").length,
      ongoing: monthCampaigns.filter((c) => c.status === "active" || c.status === "ongoing").length,
    };
  });

  const now = new Date();
  const weeklyCampaigns = Array.from({ length: 4 }, (_, i) => {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (3 - i) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const count = campaignsByStatus.data?.filter((c) => {
      const d = new Date(c.created_at);
      return d >= weekStart && d < weekEnd;
    }).length ?? 0;
    return { week: t("weekLabel", { n: i + 1 }), count };
  });

  return {
    totalInfluencers: influencersTotal.count ?? 0,
    totalBrands: brandsTotal.count ?? 0,
    totalCampaigns: campaignsTotal.count ?? 0,
    pendingInfluencerVerif: influencersPendingVerif.count ?? 0,
    pendingBrandVerif: brandsPendingVerif.count ?? 0,
    pendingCampaignApproval: campaignsPendingApproval.count ?? 0,
    monthlySignups,
    signupsDaily,
    campaignMonthly,
    weeklyCampaigns,
    openDisputes: openDisputes.data || [],
    newInfluencersToday: newInfluencersToday.count ?? 0,
    totalSubscriptions: subscriptionsTotal.count ?? 0,
    newSubscriptionsToday: newSubscriptionsLive ? newSubscriptionsToday.count : null,
    instagramStale: instagramStale.error ? null : instagramStale.count ?? 0,
    instagramNeverRefreshed: instagramNeverRefreshed.error ? null : instagramNeverRefreshed.count ?? 0,
  };
}

export default async function DashboardPage() {
  const t = await getTranslations("Dashboard");
  let stats;
  try {
    stats = await getStats(t);
  } catch (e) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">{t("title")}</h1>
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
          {t("loadError", { message: e instanceof Error ? e.message : t("unknownError") })}
        </div>
      </div>
    );
  }

  // Growth row — creators joining and paying. Each card links to its list.
  const growthCards: StatCardSpec[] = [
    {
      label: t("stats.newInfluencersToday"),
      value: stats.newInfluencersToday,
      icon: "userPlus",
      tint: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
      href: "/dashboard/influencers?tab=registered",
    },
    {
      label: t("stats.totalInfluencers"),
      value: stats.totalInfluencers,
      icon: "users",
      tint: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
      href: "/dashboard/influencers?tab=registered",
    },
    {
      label: t("stats.newSubscriptionsToday"),
      value: stats.newSubscriptionsToday,
      hint: stats.newSubscriptionsToday === null ? t("stats.newSubscriptionsNotLive") : undefined,
      icon: "cardPlus",
      tint: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
      href: "/dashboard/subscriptions",
    },
    {
      label: t("stats.totalSubscriptions"),
      value: stats.totalSubscriptions,
      icon: "card",
      tint: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400",
      href: "/dashboard/subscriptions",
    },
  ];

  // Platform + review queues, one tight row. "Pending Reviews" was just the
  // sum of the three queues shown beside it, so it's dropped in favour of them.
  const statCards: StatCardSpec[] = [
    {
      label: t("stats.totalBrands"),
      value: stats.totalBrands,
      icon: "briefcase",
      tint: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
      href: "/dashboard/brands",
    },
    {
      label: t("stats.totalCampaigns"),
      value: stats.totalCampaigns,
      icon: "megaphone",
      tint: "bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400",
      href: "/dashboard/campaigns",
    },
    {
      label: t("verif.influencer"),
      value: stats.pendingInfluencerVerif,
      icon: "userCheck",
      tint: "bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400",
      href: "/dashboard/influencers",
    },
    {
      label: t("verif.brand"),
      value: stats.pendingBrandVerif,
      icon: "badgeCheck",
      tint: "bg-yellow-50 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400",
      href: "/dashboard/brands",
    },
    {
      label: t("verif.campaign"),
      value: stats.pendingCampaignApproval,
      icon: "clock",
      tint: "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400",
      href: "/dashboard/campaigns?status=under_review",
    },
    {
      label: t("stats.instagramStale"),
      value: stats.instagramStale,
      hint:
        stats.instagramNeverRefreshed === null
          ? undefined
          : t("stats.instagramNeverRefreshed", { count: stats.instagramNeverRefreshed }),
      icon: "camera",
      tint:
        stats.instagramNeverRefreshed
          ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
          : "bg-slate-50 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400",
      href: "/dashboard/errors?area=instagram",
    },
  ];

  const cardIcons: Record<string, React.ReactNode> = {
    userCheck: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11l2 2 4-4m-9-2a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
    badgeCheck: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    userPlus: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
    card: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    cardPlus: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M12 19H6a3 3 0 01-3-3V8a3 3 0 013-3h12a3 3 0 013 3v4m-2 3v6m-3-3h6" />
      </svg>
    ),
    users: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    briefcase: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
      </svg>
    ),
    megaphone: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
    camera: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    clock: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className="space-y-6">
      {/* Mobile Operations hub — the focused "needs attention" home on phones.
          lg:hidden; desktop keeps the full overview below. */}
      <MobileOpsHub />

      {/* Welcome Banner — desktop only (marketing chrome, no actions worth a
          phone). */}
      <div className="hidden lg:block relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 p-8 text-white">
        <div className="relative z-10 max-w-xl">
          <img src="/logo.svg" alt="RecentGossips" className="h-7 brightness-200 mb-3 opacity-80" />
          <h1 className="text-2xl font-bold">{t("welcome.title")}</h1>
          <p className="mt-2 text-indigo-100 text-sm leading-relaxed">
            {t("welcome.subtitle")}
          </p>
          <div className="flex gap-3 mt-5">
            <a
              href="/dashboard/campaigns/create"
              className="inline-flex items-center px-4 py-2 rounded-lg bg-white text-indigo-600 text-sm font-semibold hover:bg-indigo-50 transition-colors"
            >
              {t("welcome.newCampaign")}
            </a>
            <a
              href="/dashboard/influencers"
              className="inline-flex items-center px-4 py-2 rounded-lg bg-white/15 text-white text-sm font-semibold hover:bg-white/25 transition-colors backdrop-blur-sm border border-white/20"
            >
              {t("welcome.viewInfluencers")}
            </a>
          </div>
        </div>
        {/* Decorative shapes */}
        <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full bg-white/10" />
        <div className="absolute right-16 -bottom-12 w-32 h-32 rounded-full bg-white/5" />
        <div className="absolute right-48 top-4 w-20 h-20 rounded-full bg-white/10" />
      </div>

      {/* High-priority disputes — surfaced front and centre because brand
          escrow funds are held while these are open. */}
      {stats.openDisputes.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-red-100/60 dark:bg-red-900/30">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0l-7.1 12.25A2 2 0 005 19z" />
              </svg>
              <h3 className="text-sm font-bold text-red-900 dark:text-red-200">
                {t("disputes.heading", { count: stats.openDisputes.length })}
              </h3>
            </div>
            <a href="/dashboard/disputes" className="text-xs font-bold text-red-700 dark:text-red-300 hover:underline">
              {t("disputes.viewAll")}
            </a>
          </div>
          <ul className="divide-y divide-red-100 dark:divide-red-900/40">
            {stats.openDisputes.map((d: any) => (
              <li key={d.application_id}>
                <a
                  href={`/dashboard/disputes/${d.application_id}`}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-red-100/40 dark:hover:bg-red-900/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {d.campaign_title || t("disputes.campaignFallback")}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">
                      {d.brand_name || t("disputes.brandFallback")} ↔ {d.influencer_name || t("disputes.creatorFallback")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">
                      ₹{Math.round((d.escrow_amount || 0) / 100).toLocaleString("en-IN")}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {d.dispute_opened_at
                        ? new Date(d.dispute_opened_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                        : ""}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats — growth row, then platform totals + review queues */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {growthCards.map((card) => (
            <StatCard key={card.label} card={card} icon={cardIcons[card.icon]} />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {statCards.map((card) => (
            <StatCard key={card.label} card={card} icon={cardIcons[card.icon]} />
          ))}
        </div>
      </div>

      {/* Charts — Recharts, heavy and not useful on a phone; desktop only. */}
      <div className="hidden lg:grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fulfilment Stats */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("charts.fulfilment.title")}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("charts.fulfilment.subtitle")}</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span className="text-gray-500 dark:text-gray-400">{t("charts.fulfilment.completed")}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span className="text-gray-500 dark:text-gray-400">{t("charts.fulfilment.ongoing")}</span>
              </span>
            </div>
          </div>
          <DashboardCharts type="fulfilment" data={stats.campaignMonthly} />
        </div>

        {/* Monthly Signups */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("charts.signups.title")}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("charts.signups.subtitle")}</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span className="text-gray-500 dark:text-gray-400">{t("charts.signups.influencer")}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-pink-400" />
                <span className="text-gray-500 dark:text-gray-400">{t("charts.signups.business")}</span>
              </span>
            </div>
          </div>
          <DashboardCharts type="signups" data={stats.monthlySignups} daily={stats.signupsDaily} />
        </div>
      </div>

      {/* Weekly campaigns full width — desktop only. */}
      <div className="hidden lg:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("charts.weekly.title")}</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("charts.weekly.subtitle")}</p>
        </div>
        <DashboardCharts type="weeklyCampaigns" data={stats.weeklyCampaigns} />
      </div>
    </div>
  );
}
