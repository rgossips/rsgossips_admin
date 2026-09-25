import { createAdminClient } from "@/utils/supabase/admin";
import { FilterBar } from "@/components/filter-bar";
import { InfluencerRow } from "./influencer-row";
import { InviteInfluencerForm } from "./invite-influencer-form";
import { InvitedInfluencerRow } from "./invited-influencer-row";
import { RefreshButton } from "@/components/refresh-button";
import { Pagination } from "@/components/pagination";
import { sanitizeSearchTerm } from "@/lib/validation";
import { authIdsByPhone, influencerInvitationIdsByPhone, listAllAuthUsers, phoneQueryDigits, type AuthUserLite } from "@/lib/phone-search";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { UpdateMissingDetails } from "./update-missing-details";
import { getTranslations } from "next-intl/server";
import { instagramStatus, type IgStatus } from "@/lib/instagram-status";
import { getCreatorCategoryOptions } from "@/lib/creator-categories";

const INVITES_PER_PAGE = 12;
const INFLUENCERS_PER_PAGE = 25;
const IG_STATUSES: IgStatus[] = ["authorized", "insights_denied", "reconnect", "not_connected"];

// Module scope: reading the clock during render trips react-hooks/purity.
function nowIso() {
  return new Date().toISOString();
}

export default async function InfluencersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const t = await getTranslations("DashboardInfluencers");
  const params = await searchParams;
  const { search, status, followers, category, tab, invite_page, page } = params;
  const igstatus = IG_STATUSES.includes(params.igstatus as IgStatus) ? (params.igstatus as IgStatus) : "";
  const supabase = createAdminClient();
  const activeTab = tab || "all";
  const invitePage = Math.max(1, parseInt(invite_page || "1", 10) || 1);
  const influencerPage = Math.max(1, parseInt(page || "1", 10) || 1);
  // Sanitize before it ever reaches a hand-built PostgREST .or() filter
  // (the query runs on the RLS-bypassing service-role client).
  const searchTerm = sanitizeSearchTerm(search);

  // Category options and the phone map are both independent of the row query
  // and of each other — started together so the page waits once, not three
  // times (every round trip crosses to the Mumbai project).
  const [categoryOptions, authUsers, canWrite] = await Promise.all([
    getCreatorCategoryOptions(),
    listAllAuthUsers(supabase).catch(() => [] as AuthUserLite[]),
    isAdminOrAbove(),
  ]);

  const filterFields = [
    { name: "search", label: t("filter.search"), type: "text" as const, placeholder: t("filter.searchPlaceholder") },
    { name: "status", label: t("filter.allStatuses"), type: "select" as const, options: [{ label: t("filter.active"), value: "active" }, { label: t("filter.suspended"), value: "suspended" }, { label: t("filter.pending"), value: "pending" }] },
    { name: "followers", label: t("filter.followers"), type: "select" as const, options: [{ label: t("filter.followersUnder1k"), value: "0-1000" }, { label: t("filter.followers1kTo10k"), value: "1000-10000" }, { label: t("filter.followers10kTo100k"), value: "10000-100000" }, { label: t("filter.followers100kPlus"), value: "100000-" }] },
    { name: "category", label: t("filter.allCategories"), type: "multiselect" as const, options: categoryOptions },
    { name: "igstatus", label: t("filter.allIgStatuses"), type: "select" as const, options: IG_STATUSES.map((s) => ({ label: t(`igStatus.${s}`), value: s })) },
  ];

  // Phone numbers live on auth.users, not influencer_profiles — the map above
  // serves both the phone column and phone search. A failed read is
  // non-fatal: the column shows "—" and phone search matches nothing.
  //
  // A digits-only search ("98765 43210", "+91…") also matches by phone: the
  // number is resolved to ids here and OR-ed into the name search below.
  const phoneQuery = phoneQueryDigits(search);
  const phoneInfluencerIds = phoneQuery ? authIdsByPhone(authUsers, phoneQuery) : [];
  const phoneInviteIds = phoneQuery ? await influencerInvitationIdsByPhone(supabase, phoneQuery) : [];

  // Fetch influencers — one page at a time. `count: exact` gives the filtered
  // total for the tab badge and the pager; the id tiebreak keeps rows with the
  // same updated_at from shuffling between pages.
  const infFrom = (influencerPage - 1) * INFLUENCERS_PER_PAGE;
  let query = supabase
    .from("influencer_profiles")
    // The token and IG health columns are read only to derive igStatus below;
    // they never reach the client row.
    .select("influencer_id, full_name, username, profile_photo_url, followers_count, categories, status, instagram_handle, media_kit_published, instagram_access_token, instagram_token_expires_at, instagram_token_invalid_at, instagram_insights_denied_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .order("influencer_id", { ascending: true })
    .range(infFrom, infFrom + INFLUENCERS_PER_PAGE - 1);
  if (searchTerm) {
    const clauses = [`full_name.ilike.%${searchTerm}%`, `username.ilike.%${searchTerm}%`];
    if (phoneInfluencerIds.length > 0) clauses.push(`influencer_id.in.(${phoneInfluencerIds.join(",")})`);
    query = query.or(clauses.join(","));
  }
  if (status) query = query.eq("status", status);
  if (followers) { const [min, max] = followers.split("-"); if (min) query = query.gte("followers_count", parseInt(min)); if (max) query = query.lte("followers_count", parseInt(max)); }
  if (category) { const cats = category.split(",").filter(Boolean); if (cats.length > 0) query = query.contains("categories", cats); }
  // Same rules as instagramStatus(), expressed as filters so paging and the
  // count stay right. Separate .or() params are AND-ed by PostgREST.
  if (igstatus) {
    const now = `"${nowIso()}"`;
    const tokenLive = `instagram_token_expires_at.is.null,instagram_token_expires_at.gte.${now}`;
    if (igstatus === "not_connected") {
      query = query.is("instagram_access_token", null);
    } else if (igstatus === "reconnect") {
      query = query
        .not("instagram_access_token", "is", null)
        .or(`instagram_token_invalid_at.not.is.null,instagram_token_expires_at.lt.${now}`);
    } else if (igstatus === "insights_denied" || igstatus === "authorized") {
      query = query.not("instagram_access_token", "is", null).is("instagram_token_invalid_at", null).or(tokenLive);
      query = igstatus === "insights_denied"
        ? query.not("instagram_insights_denied_at", "is", null)
        : query.is("instagram_insights_denied_at", null);
    }
  }
  // Pending invitations — paginated. `count: exact` gives the total so paging
  // stays correct after filtering. Built here so it runs alongside the
  // creator rows rather than after them.
  const inviteFrom = (invitePage - 1) * INVITES_PER_PAGE;
  let inviteQuery = supabase
    .from("influencer_invitations")
    .select("id, full_name, instagram_username, profile_photo_url, notes, status, created_at", { count: "exact" })
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .range(inviteFrom, inviteFrom + INVITES_PER_PAGE - 1);
  if (searchTerm) {
    const clauses = [`full_name.ilike.%${searchTerm}%`, `instagram_username.ilike.%${searchTerm}%`];
    if (phoneInviteIds.length > 0) clauses.push(`id.in.(${phoneInviteIds.join(",")})`);
    inviteQuery = inviteQuery.or(clauses.join(","));
  }
  const [
    { data: influencerRows, error, count: influencerCount },
    { data: pendingInvites, error: invitesError, count: pendingInviteCount },
  ] = await Promise.all([query, inviteQuery]);
  const influencersTotal = influencerCount ?? 0;
  const invitesTotal = pendingInviteCount ?? 0;
  const influencers = (influencerRows || []).map(
    ({ instagram_access_token, instagram_token_expires_at, instagram_token_invalid_at, instagram_insights_denied_at, ...rest }) => ({
      ...rest,
      igStatus: instagramStatus({ instagram_access_token, instagram_token_expires_at, instagram_token_invalid_at, instagram_insights_denied_at }),
    }),
  );

  // id→phone map for the column, without an N+1.
  const phoneMap = new Map<string, string>();
  for (const u of authUsers) {
    if (u.phone) phoneMap.set(u.id, u.phone);
  }

  const allCount = influencersTotal + invitesTotal;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && <UpdateMissingDetails />}
          <RefreshButton />
        </div>
      </div>

      <InviteInfluencerForm />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl mb-6 w-fit">
        <TabLink label={t("tabs.all")} value="all" active={activeTab} count={allCount} />
        <TabLink label={t("tabs.registered")} value="registered" active={activeTab} count={influencersTotal} />
        <TabLink label={t("tabs.invited")} value="invited" active={activeTab} count={invitesTotal} />
      </div>

      {(activeTab === "all" || activeTab === "registered") && (
        <>
          <FilterBar fields={filterFields} />
          {error && <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">{t("failedToLoadInfluencers", { message: error.message })}</div>}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full min-w-180">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.name")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.username")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.contactNumber")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.followers")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.categories")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.status")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.igStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {influencers.length > 0 ? influencers.map((inf) => <InfluencerRow key={inf.influencer_id} inf={inf} phone={phoneMap.get(inf.influencer_id) ?? null} />) : (
                  <tr><td colSpan={7} className="px-6 py-16 text-center text-sm text-gray-400 dark:text-gray-500">{t("noRegisteredInfluencers")}</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
          <Pagination
            basePath="/dashboard/influencers"
            pageParam="page"
            currentParams={params}
            page={influencerPage}
            perPage={INFLUENCERS_PER_PAGE}
            total={influencersTotal}
          />
        </>
      )}

      {(activeTab === "all" || activeTab === "invited") && (
        <>
          {activeTab === "all" && pendingInvites && pendingInvites.length > 0 && (
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mt-8 mb-4">{t("pendingInvitations")}</h3>
          )}
          {invitesError && <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">{t("failedToLoadInvitations", { message: invitesError.message })}</div>}
          {pendingInvites && pendingInvites.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pendingInvites.map((invite) => <InvitedInfluencerRow key={invite.id} invitation={invite} />)}
              </div>
              <Pagination
                basePath="/dashboard/influencers"
                pageParam="invite_page"
                currentParams={params}
                page={invitePage}
                perPage={INVITES_PER_PAGE}
                total={invitesTotal}
              />
            </>
          ) : activeTab === "invited" ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-16 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("noPendingInvitations")}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("clickInviteToCreate")}</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TabLink({ label, value, active, count }: { label: string; value: string; active: string; count: number }) {
  return (
    <a href={`/dashboard/influencers?tab=${value}`} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${active === value ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}>
      {label}
      {count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${active === value ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400" : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>{count}</span>}
    </a>
  );
}
