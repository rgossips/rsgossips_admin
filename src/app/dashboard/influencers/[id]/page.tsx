import { createAdminClient } from "@/utils/supabase/admin";
import { notFound } from "next/navigation";
import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";
import { EditInfluencerButton } from "./edit-influencer";
import { ChangePlanButton } from "./change-plan";
import { DeleteInfluencerButton } from "./delete-influencer";
import { ReferralLinkCard } from "./referral-link-card";
import { Avatar } from "@/components/avatar";
import { InstagramLink } from "@/components/instagram-link";
import { isSuperAdmin, isAdminOrAbove } from "@/lib/require-super-admin";
import { applicationBadge } from "@/lib/application-status";
import { logError } from "@/lib/log";
import { getTranslations } from "next-intl/server";

type AppliedCampaign = {
  id: string;
  campaign_id: string;
  status: string;
  created_at: string;
  campaigns: {
    title: string | null;
    brand_profiles: { brand_name: string | null } | null;
    brand_invitations: { brand_name: string | null } | null;
  } | null;
};

export default async function InfluencerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("DashboardInfluencersId");
  const supabase = createAdminClient();

  const { data: inf, error } = await supabase
    .from("influencer_profiles")
    .select("*")
    .eq("influencer_id", id)
    .single();

  if (error || !inf) notFound();

  // Phone lives on auth.users (creators sign in by phone), not the
  // profile row. Fetch it separately — non-fatal if the call fails.
  let phone: string | null = null;
  try {
    const { data: authUserRes } = await supabase.auth.admin.getUserById(id);
    phone = authUserRes?.user?.phone || null;
  } catch {
    /* leave phone null — UI will show — */
  }

  const [superAdmin, canWrite] = await Promise.all([isSuperAdmin(), isAdminOrAbove()]);

  // Every campaign this creator applied to, newest first. Brand name comes
  // from the registered profile or, for an admin-created campaign, the
  // invitation row — same fallback the campaign pages use.
  const { data: appliedRows, error: appliedError } = await supabase
    .from("campaign_applications")
    .select("id, campaign_id, status, created_at, campaigns(title, brand_profiles(brand_name), brand_invitations(brand_name))")
    .eq("influencer_id", id)
    .order("created_at", { ascending: false });
  if (appliedError) logError("influencer-applications", appliedError, { influencerId: id });
  const applied = (appliedRows || []) as unknown as AppliedCampaign[];
  const ta = await getTranslations("DashboardCampaignsIdApplications");
  const statusLabel = (s: string) => {
    try {
      return ta(`status.${s}` as never);
    } catch {
      return s; // a status the catalog doesn't know yet
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  const statusConfig: Record<string, { bg: string; dot: string }> = {
    active: { bg: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    suspended: { bg: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400", dot: "bg-red-500" },
    pending: { bg: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400", dot: "bg-yellow-500" },
    inactive: { bg: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400", dot: "bg-gray-400" },
  };
  const st = statusConfig[inf.status] || statusConfig.inactive;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/influencers" className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div className="flex items-center gap-4">
            <Avatar src={inf.profile_photo_url} name={inf.full_name} size="xl" shape="rounded" className="!border-2 !border-white dark:!border-gray-800 shadow-lg" />
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{inf.full_name || t("unknown")}</h1>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${st.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{inf.status || t("statusUnknown")}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {inf.instagram_handle && <InstagramLink handle={inf.instagram_handle} className="text-sm text-gray-500 dark:text-gray-400" />}
                {inf.username && inf.username !== inf.instagram_handle && (<><span className="text-gray-300 dark:text-gray-700">|</span><InstagramLink handle={inf.username} showAt={false} className="text-sm text-gray-400 dark:text-gray-500" /></>)}
                <span className="text-gray-300 dark:text-gray-700">|</span>
                <span className="text-sm text-gray-400 dark:text-gray-500">{t("joinedDate", { date: formatDate(inf.created_at) })}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && <ChangePlanButton influencerId={inf.influencer_id} currentPlan={inf.subscription_plan} currentCycle={inf.billing_cycle} />}
          {canWrite && <EditInfluencerButton influencer={inf} />}
          {superAdmin && (
            <DeleteInfluencerButton
              influencerId={inf.influencer_id}
              displayName={inf.full_name || inf.username || inf.instagram_handle || t("deleteFallbackName")}
              confirmText={inf.instagram_handle || inf.username || inf.full_name || "DELETE"}
            />
          )}
          <RefreshButton />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard label={t("stats.followers")} value={inf.followers_count?.toLocaleString() || "0"} color="indigo" />
            <StatCard label={t("stats.following")} value={inf.follows_count?.toLocaleString() || "0"} color="purple" />
            <StatCard label={t("stats.posts")} value={inf.media_count?.toLocaleString() || "0"} color="pink" />
          </div>

          {inf.bio && (
            <Card icon="M4 6h16M4 12h16M4 18h7" color="indigo" title={t("card.bio")}>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{inf.bio}</p>
            </Card>
          )}

          {inf.categories && inf.categories.length > 0 && (
            <Card icon="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" color="amber" title={t("card.categories")}>
              <div className="flex flex-wrap gap-2">
                {inf.categories.map((cat: string) => (
                  <span key={cat} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">{cat}</span>
                ))}
              </div>
            </Card>
          )}

          <Card icon="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" color="emerald" title={t("card.contactLocation")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem label={t("info.email")} value={inf.email || "—"} />
              <InfoItem label={t("info.phone")} value={phone ? (phone.startsWith("+") ? phone : `+${phone}`) : "—"} />
              <InfoItem label={t("info.city")} value={inf.city || "—"} />
              <InfoItem label={t("info.state")} value={inf.state || "—"} />
            </div>
          </Card>

          {/* Applied campaigns — only the campaign name links out. */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("applications.title")}</h2>
              {applied.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  {applied.length}
                </span>
              )}
            </div>
            {appliedError ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400 dark:text-gray-500">{t("applications.loadError")}</p>
            ) : applied.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400 dark:text-gray-500">{t("applications.empty")}</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {applied.map((a) => {
                  const brand = a.campaigns?.brand_profiles?.brand_name || a.campaigns?.brand_invitations?.brand_name;
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-4 px-6 py-3.5">
                      <div className="min-w-0">
                        <Link
                          href={`/dashboard/campaigns/${a.campaign_id}`}
                          className="text-sm font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline underline-offset-2 transition-colors truncate block"
                        >
                          {a.campaigns?.title || t("applications.untitledCampaign")}
                        </Link>
                        {brand && <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{brand}</p>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${applicationBadge(a.status)}`}>
                          {statusLabel(a.status)}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(a.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <summary className="px-6 py-4 text-sm font-medium text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">{t("rawData")}</summary>
            <div className="px-6 pb-6"><pre className="text-xs text-gray-500 dark:text-gray-400 overflow-auto whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded-xl p-4">{JSON.stringify(inf, null, 2)}</pre></div>
          </details>
        </div>

        <div className="space-y-6">
          <SidebarTable title={t("profileDetails.title")} rows={[
            [t("profileDetails.fullName"), inf.full_name || "—"],
            [t("profileDetails.username"), <InstagramLink key="u" handle={inf.username || inf.instagram_handle} showAt={false} />],
            ["Instagram", <InstagramLink key="ig" handle={inf.instagram_handle} />],
            [t("profileDetails.status"), inf.status || "—"],
            [t("profileDetails.verification"), inf.verification_status || "—"],
            [t("profileDetails.plan"), inf.subscription_plan ? `${inf.subscription_plan.charAt(0).toUpperCase() + inf.subscription_plan.slice(1)}${inf.billing_cycle ? ` · ${inf.billing_cycle.charAt(0).toUpperCase() + inf.billing_cycle.slice(1)}` : ""}` : t("planFree")],
            [t("profileDetails.source"), inf.source || "—"],
          ]} />
          <SidebarTable title={t("igStats.title")} rows={[
            [t("igStats.followers"), inf.followers_count?.toLocaleString() || "0"],
            [t("igStats.following"), inf.follows_count?.toLocaleString() || "0"],
            [t("igStats.media"), inf.media_count?.toLocaleString() || "0"],
            [t("igStats.engagement"), inf.engagement_rate ? `${inf.engagement_rate}%` : "—"],
          ]} />
          <ReferralLinkCard referralCode={inf.referral_code} />
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800"><h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("timeline.title")}</h2></div>
            <div className="p-5 space-y-3">
              <DateItem label={t("timeline.joined")} date={formatDate(inf.created_at)} />
              <DateItem label={t("timeline.updated")} date={formatDate(inf.updated_at)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const c: Record<string, string> = { indigo: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400", purple: "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400", pink: "bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400" };
  return (<div className={`${c[color]} rounded-2xl p-5 text-center`}><p className="text-2xl font-bold">{value}</p><p className="text-[11px] font-semibold uppercase tracking-wider mt-1 opacity-70">{label}</p></div>);
}

function Card({ icon, color, title, children }: { icon: string; color: string; title: string; children: React.ReactNode }) {
  const bg: Record<string, string> = { indigo: "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400", amber: "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400", emerald: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" };
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg ${bg[color]} flex items-center justify-center`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} /></svg></div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (<div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/50"><p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p><p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">{value}</p></div>);
}

function SidebarTable({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800"><h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2></div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map(([l, v]) => (<div key={l} className="flex items-center justify-between px-6 py-3.5"><span className="text-[13px] text-gray-500 dark:text-gray-400">{l}</span><span className="text-[13px] font-semibold text-gray-900 dark:text-white">{v}</span></div>))}
      </div>
    </div>
  );
}

function DateItem({ label, date }: { label: string; date: string }) {
  return (<div className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" /><div className="flex-1 flex items-center justify-between"><span className="text-[13px] text-gray-500 dark:text-gray-400">{label}</span><span className="text-[13px] font-medium text-gray-900 dark:text-white">{date}</span></div></div>);
}
