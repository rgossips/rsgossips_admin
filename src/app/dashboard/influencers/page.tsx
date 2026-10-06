import { createAdminClient } from "@/utils/supabase/admin";
import { FilterBar } from "@/components/filter-bar";
import { InfluencerRow, InfluencerCard } from "./influencer-row";
import { CardList, CardListItem } from "@/components/mobile/list-card";
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
import { INDIAN_CITIES } from "@/lib/cities";
import { INDIAN_LANGUAGES } from "@/lib/languages";
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-plans";
import { platformsForUsers } from "@/lib/device-platforms";
import { SortBar, SortLink } from "@/components/sort-controls";
import { applySort, resolveSort, type SortOption } from "@/lib/sorting";

const BASE = "/dashboard/influencers";

// Only fields with real variety on the live table get a filter. Measured
// over 493 profiles: gender 3 values (50% filled), media_kit_published
// 56 true / 437 false, subscription_plan 5 values, engagement_rate on every
// row. Deliberately NOT offered: `is_verified`, `tier` and
// `notifications_enabled` (one value each across the whole base, so the
// control would be decoration) and `creator_type` (never populated).
const GENDERS = ["female", "male", "non_binary", "prefer_not_to_say"] as const;
// "paid" is the question an admin actually asks — `trial` and `free` are
// column defaults rather than purchases (see CLAUDE.md, Subscriptions).
const PAID_PLANS = SUBSCRIPTION_TIERS.map((tier) => tier.key as string);
const PLAN_FILTERS = ["paid", ...PAID_PLANS, "trial", "free"] as const;
const ER_BANDS = ["0-1", "1-3", "3-6", "6-"] as const;

// Registered creators. Paginated, so the sort MUST go to PostgREST — an
// in-memory sort would only reorder the 25 rows on the current page, which
// looks like sorting and isn't.
//
// Every column here is selected by the query above. `influencer_id` is the
// tiebreak throughout: without a stable second key, rows with equal values
// shuffle between pages and a creator can appear twice or not at all.
function influencerSorts(label: (k: string) => string): SortOption[] {
  const tiebreak = { column: "influencer_id", ascending: true };
  return [
    { key: "recent", column: "updated_at", label: label("recent"), defaultDir: "desc", tiebreak },
    { key: "joined", column: "created_at", label: label("joined"), defaultDir: "desc", tiebreak },
    { key: "name", column: "full_name", label: label("name"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "username", column: "username", label: label("username"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "followers", column: "followers_count", label: label("followers"), defaultDir: "desc", nullsLast: true, tiebreak },
    { key: "status", column: "status", label: label("status"), defaultDir: "asc", tiebreak },
  ];
}

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
  // Each validated against its allowlist before it reaches a query.
  const gender = (GENDERS as readonly string[]).includes(params.gender || "") ? params.gender! : "";
  const plan = (PLAN_FILTERS as readonly string[]).includes(params.plan || "") ? params.plan! : "";
  const mediakit = params.mediakit === "yes" || params.mediakit === "no" ? params.mediakit : "";
  const er = (ER_BANDS as readonly string[]).includes(params.er || "") ? params.er! : "";
  // Cities and languages come from the shared owners, so a value that isn't
  // one of ours can't be used to build the ilike / contains below.
  const city = INDIAN_CITIES.includes(params.city || "") ? params.city! : "";
  const language = INDIAN_LANGUAGES.includes(params.language || "") ? params.language! : "";
  const supabase = createAdminClient();
  const activeTab = tab || "all";
  const invitePage = Math.max(1, parseInt(invite_page || "1", 10) || 1);
  const influencerPage = Math.max(1, parseInt(page || "1", 10) || 1);
  // Sanitize before it ever reaches a hand-built PostgREST .or() filter
  // (the query runs on the RLS-bypassing service-role client).
  const searchTerm = sanitizeSearchTerm(search);
  const SORTS = influencerSorts((k) => t(`sort.${k}`));
  // `recent` is the fallback, so a page with no ?sort keeps the
  // most-recently-updated-first order it had before sorting existed.
  const sort = resolveSort(params.sort, SORTS, "recent");

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
    { name: "status", label: t("filter.allStatuses"), type: "select" as const, options: [{ label: t("filter.active"), value: "active" }, { label: t("filter.suspended"), value: "suspended" }, { label: t("filter.pending"), value: "pending" }, { label: t("filter.pendingDeletion"), value: "pending_deletion" }] },
    { name: "followers", label: t("filter.followers"), type: "select" as const, options: [{ label: t("filter.followersUnder1k"), value: "0-1000" }, { label: t("filter.followers1kTo10k"), value: "1000-10000" }, { label: t("filter.followers10kTo100k"), value: "10000-100000" }, { label: t("filter.followers100kPlus"), value: "100000-" }] },
    { name: "category", label: t("filter.allCategories"), type: "multiselect" as const, options: categoryOptions },
    { name: "igstatus", label: t("filter.allIgStatuses"), type: "select" as const, options: IG_STATUSES.map((s) => ({ label: t(`igStatus.${s}`), value: s })) },
    { name: "gender", label: t("filter.allGenders"), type: "select" as const, options: GENDERS.map((g) => ({ label: t(`gender.${g}`), value: g })) },
    { name: "plan", label: t("filter.allPlans"), type: "select" as const, options: PLAN_FILTERS.map((p) => ({ label: t(`plan.${p}`), value: p })) },
    { name: "er", label: t("filter.allEngagement"), type: "select" as const, options: ER_BANDS.map((b) => ({ label: t(`engagement.${b}`), value: b })) },
    { name: "city", label: t("filter.allCities"), type: "select" as const, options: INDIAN_CITIES.map((c) => ({ label: c, value: c })) },
    { name: "language", label: t("filter.allLanguages"), type: "select" as const, options: INDIAN_LANGUAGES.map((l) => ({ label: l, value: l })) },
    { name: "mediakit", label: t("filter.allMediaKits"), type: "select" as const, options: [{ label: t("mediakit.yes"), value: "yes" }, { label: t("mediakit.no"), value: "no" }] },
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
    .select("influencer_id, full_name, username, profile_photo_url, followers_count, categories, status, instagram_handle, media_kit_published, instagram_access_token, instagram_token_expires_at, instagram_token_invalid_at, instagram_insights_denied_at", { count: "exact" });
  query = applySort(query, sort).range(infFrom, infFrom + INFLUENCERS_PER_PAGE - 1);
  if (searchTerm) {
    const clauses = [`full_name.ilike.%${searchTerm}%`, `username.ilike.%${searchTerm}%`];
    if (phoneInfluencerIds.length > 0) clauses.push(`influencer_id.in.(${phoneInfluencerIds.join(",")})`);
    query = query.or(clauses.join(","));
  }
  if (status) query = query.eq("status", status);
  if (followers) { const [min, max] = followers.split("-"); if (min) query = query.gte("followers_count", parseInt(min)); if (max) query = query.lte("followers_count", parseInt(max)); }
  if (category) { const cats = category.split(",").filter(Boolean); if (cats.length > 0) query = query.contains("categories", cats); }
  if (gender) query = query.eq("gender", gender);
  if (plan) query = plan === "paid" ? query.in("subscription_plan", PAID_PLANS) : query.eq("subscription_plan", plan);
  if (mediakit) query = query.eq("media_kit_published", mediakit === "yes");
  // Engagement bands. `engagement_rate` is a percentage, populated on every
  // row, and the floors match how briefs are written ("3%+ creators").
  if (er) { const [min, max] = er.split("-"); if (min) query = query.gte("engagement_rate", Number(min)); if (max) query = query.lte("engagement_rate", Number(max)); }
  // `location` is a comma-joined scalar, not an array (see CLAUDE.md,
  // "Cities / location"), so this is a substring match — the same thing the
  // consumer app's matcher does. Only 14% of profiles have one set, so this
  // narrows hard by design: it answers "who do we have in Delhi", not
  // "everyone except Delhi".
  if (city) query = query.ilike("location", `%${city}%`);
  if (language) query = query.contains("content_languages", [language]);
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

  // Which platforms each visible creator signs in from. Scoped to the 25
  // ids on this page, so it is one small query rather than a scan of every
  // session — and it runs after the row query because it needs those ids.
  const platformMap = await platformsForUsers(
    supabase,
    influencers.map((i) => i.influencer_id),
  );

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
          {/* Cards have no headers to click, so this is the only way to
              reorder on a phone. */}
          <SortBar options={SORTS} current={sort} basePath={BASE} params={params} className="mb-4" />
          {error && <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">{t("failedToLoadInfluencers", { message: error.message })}</div>}
          {/* Phones get cards; the table is a desktop affordance. Same rows,
              same order, same page — see components/mobile/list-card.tsx. */}
          <CardList>
            {influencers.length > 0 ? (
              influencers.map((inf) => (
                <CardListItem key={inf.influencer_id}>
                  <InfluencerCard inf={inf} phone={phoneMap.get(inf.influencer_id) ?? null} platforms={platformMap.get(inf.influencer_id)?.platforms} />
                </CardListItem>
              ))
            ) : (
              <li className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
                {t("noRegisteredInfluencers")}
              </li>
            )}
          </CardList>

          <div className="hidden lg:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full min-w-180">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  {(["name", "username", "contactNumber", "followers", "categories", "status"] as const).map((c) => {
                    // No sort on contactNumber (the phone lives on
                    // auth.users, which can't be joined — see CLAUDE.md) or
                    // on categories (an array, with no meaningful order).
                    const option = SORTS.find((o) => o.key === c);
                    return (
                      <th
                        key={c}
                        className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5"
                      >
                        {option ? (
                          <SortLink option={option} current={sort} basePath={BASE} params={params} />
                        ) : (
                          t(`table.${c}`)
                        )}
                      </th>
                    );
                  })}
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.igStatus")}</th>
                  {/* Not sortable: the platforms come from device_sessions,
                      which PostgREST cannot order this query by. */}
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("table.platforms")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {influencers.length > 0 ? influencers.map((inf) => <InfluencerRow key={inf.influencer_id} inf={inf} phone={phoneMap.get(inf.influencer_id) ?? null} platforms={platformMap.get(inf.influencer_id)?.platforms} />) : (
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
