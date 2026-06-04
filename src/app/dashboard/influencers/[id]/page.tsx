import { createAdminClient } from "@/utils/supabase/admin";
import { notFound } from "next/navigation";
import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";
import { EditInfluencerButton } from "./edit-influencer";
import { ChangePlanButton } from "./change-plan";
import { DeleteInfluencerButton } from "./delete-influencer";
import { Avatar } from "@/components/avatar";
import { isSuperAdmin } from "@/lib/require-super-admin";

export default async function InfluencerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: inf, error } = await supabase
    .from("influencer_profiles")
    .select("*")
    .eq("influencer_id", id)
    .single();

  if (error || !inf) notFound();

  const superAdmin = await isSuperAdmin();

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
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{inf.full_name || "Unknown"}</h1>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${st.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{inf.status || "unknown"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {inf.instagram_handle && <span className="text-sm text-gray-500 dark:text-gray-400">@{inf.instagram_handle}</span>}
                {inf.username && inf.username !== inf.instagram_handle && (<><span className="text-gray-300 dark:text-gray-700">|</span><span className="text-sm text-gray-400 dark:text-gray-500">{inf.username}</span></>)}
                <span className="text-gray-300 dark:text-gray-700">|</span>
                <span className="text-sm text-gray-400 dark:text-gray-500">Joined {formatDate(inf.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ChangePlanButton influencerId={inf.influencer_id} currentPlan={inf.subscription_plan} />
          <EditInfluencerButton influencer={inf} />
          {superAdmin && (
            <DeleteInfluencerButton
              influencerId={inf.influencer_id}
              displayName={inf.full_name || inf.username || inf.instagram_handle || "Influencer"}
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
            <StatCard label="Followers" value={inf.followers_count?.toLocaleString() || "0"} color="indigo" />
            <StatCard label="Following" value={inf.follows_count?.toLocaleString() || "0"} color="purple" />
            <StatCard label="Posts" value={inf.media_count?.toLocaleString() || "0"} color="pink" />
          </div>

          {inf.bio && (
            <Card icon="M4 6h16M4 12h16M4 18h7" color="indigo" title="Bio">
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{inf.bio}</p>
            </Card>
          )}

          {inf.categories && inf.categories.length > 0 && (
            <Card icon="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" color="amber" title="Categories">
              <div className="flex flex-wrap gap-2">
                {inf.categories.map((cat: string) => (
                  <span key={cat} className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">{cat}</span>
                ))}
              </div>
            </Card>
          )}

          <Card icon="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" color="emerald" title="Contact & Location">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoItem label="Email" value={inf.email || "—"} />
              <InfoItem label="Phone" value={inf.phone || "—"} />
              <InfoItem label="City" value={inf.city || "—"} />
              <InfoItem label="State" value={inf.state || "—"} />
            </div>
          </Card>

          <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <summary className="px-6 py-4 text-sm font-medium text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">Raw Data</summary>
            <div className="px-6 pb-6"><pre className="text-xs text-gray-500 dark:text-gray-400 overflow-auto whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded-xl p-4">{JSON.stringify(inf, null, 2)}</pre></div>
          </details>
        </div>

        <div className="space-y-6">
          <SidebarTable title="Profile Details" rows={[
            ["Full Name", inf.full_name || "—"],
            ["Username", inf.username || "—"],
            ["Instagram", inf.instagram_handle ? `@${inf.instagram_handle}` : "—"],
            ["Status", inf.status || "—"],
            ["Verification", inf.verification_status || "—"],
            ["Plan", inf.subscription_plan ? inf.subscription_plan.charAt(0).toUpperCase() + inf.subscription_plan.slice(1) : "Free"],
            ["Source", inf.source || "—"],
          ]} />
          <SidebarTable title="Instagram Stats" rows={[
            ["Followers", inf.followers_count?.toLocaleString() || "0"],
            ["Following", inf.follows_count?.toLocaleString() || "0"],
            ["Media", inf.media_count?.toLocaleString() || "0"],
            ["Engagement", inf.engagement_rate ? `${inf.engagement_rate}%` : "—"],
          ]} />
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800"><h2 className="text-sm font-semibold text-gray-900 dark:text-white">Timeline</h2></div>
            <div className="p-5 space-y-3">
              <DateItem label="Joined" date={formatDate(inf.created_at)} />
              <DateItem label="Updated" date={formatDate(inf.updated_at)} />
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

function SidebarTable({ title, rows }: { title: string; rows: [string, string][] }) {
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
