import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { DashboardCharts } from "./charts";

async function getStats(t: (key: string, values?: Record<string, string | number | Date>) => string) {
  const supabase = createAdminClient();

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
      .eq("status", "pending"),
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
  ]);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthlySignups = months.map((month, i) => {
    const infCount = influencersByMonth.data?.filter(
      (r) => new Date(r.created_at).getMonth() === i
    ).length ?? 0;
    const brandCount = brandsByMonth.data?.filter(
      (r) => new Date(r.created_at).getMonth() === i
    ).length ?? 0;
    return { month, influencers: infCount, brands: brandCount };
  });

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
    campaignMonthly,
    weeklyCampaigns,
    openDisputes: openDisputes.data || [],
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

  const statCards = [
    {
      label: t("stats.totalInfluencers"),
      value: stats.totalInfluencers,
      icon: "users",
      color: "blue",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      iconBg: "bg-blue-500",
      textColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: t("stats.totalBrands"),
      value: stats.totalBrands,
      icon: "briefcase",
      color: "emerald",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      iconBg: "bg-emerald-500",
      textColor: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: t("stats.totalCampaigns"),
      value: stats.totalCampaigns,
      icon: "megaphone",
      color: "purple",
      bg: "bg-purple-50 dark:bg-purple-900/20",
      iconBg: "bg-purple-500",
      textColor: "text-purple-600 dark:text-purple-400",
    },
    {
      label: t("stats.pendingReviews"),
      value: stats.pendingInfluencerVerif + stats.pendingBrandVerif + stats.pendingCampaignApproval,
      icon: "clock",
      color: "amber",
      bg: "bg-amber-50 dark:bg-amber-900/20",
      iconBg: "bg-amber-500",
      textColor: "text-amber-600 dark:text-amber-400",
    },
  ];

  const cardIcons: Record<string, React.ReactNode> = {
    users: (
      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    briefcase: (
      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
      </svg>
    ),
    megaphone: (
      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
    clock: (
      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 p-8 text-white">
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

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 transition-all duration-300"
          >
            <div className="flex items-center justify-between">
              <div className={`w-11 h-11 rounded-xl ${card.iconBg} flex items-center justify-center shadow-lg shadow-${card.color}-200/50 dark:shadow-${card.color}-900/30`}>
                {cardIcons[card.icon]}
              </div>
              <div className="flex items-center gap-1 text-xs font-medium text-emerald-500">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17l9.2-9.2M17 17V7H7" />
                </svg>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{card.value.toLocaleString()}</p>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{card.label}</p>
            </div>
            {/* Mini bar indicator */}
            <div className="mt-4 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${card.iconBg}`}
                style={{ width: `${Math.min(100, Math.max(15, card.value * 10))}%`, opacity: 0.7 }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Verification breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {[
          { label: t("verif.influencer"), value: stats.pendingInfluencerVerif, color: "bg-pink-500", lightBg: "bg-pink-50 dark:bg-pink-900/20", href: "/dashboard/influencers" },
          { label: t("verif.brand"), value: stats.pendingBrandVerif, color: "bg-yellow-500", lightBg: "bg-yellow-50 dark:bg-yellow-900/20", href: "/dashboard/brands" },
          { label: t("verif.campaign"), value: stats.pendingCampaignApproval, color: "bg-teal-500", lightBg: "bg-teal-50 dark:bg-teal-900/20", href: "/dashboard/campaigns" },
        ].map((item) => (
          <a
            key={item.label}
            href={item.href}
            className="flex items-center gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 transition-all duration-300 group"
          >
            <div className={`w-3 h-12 rounded-full ${item.color}`} />
            <div className="flex-1 min-w-0">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{item.value}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.label}</p>
            </div>
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fulfilment Stats */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Fulfilment Stats</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Campaigns Completed vs Ongoing</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span className="text-gray-500 dark:text-gray-400">Completed</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span className="text-gray-500 dark:text-gray-400">Ongoing</span>
              </span>
            </div>
          </div>
          <DashboardCharts type="fulfilment" data={stats.campaignMonthly} />
        </div>

        {/* Monthly Signups */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Monthly Signups</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Influencer & Brand Registrations</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span className="text-gray-500 dark:text-gray-400">Influencer</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-pink-400" />
                <span className="text-gray-500 dark:text-gray-400">Business</span>
              </span>
            </div>
          </div>
          <DashboardCharts type="signups" data={stats.monthlySignups} />
        </div>
      </div>

      {/* Weekly campaigns full width */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Weekly New Campaigns</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Campaign creation over the last 4 weeks</p>
        </div>
        <DashboardCharts type="weeklyCampaigns" data={stats.weeklyCampaigns} />
      </div>
    </div>
  );
}
