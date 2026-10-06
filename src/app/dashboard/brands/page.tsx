import { createAdminClient } from "@/utils/supabase/admin";
import { FilterBar } from "@/components/filter-bar";
import { BrandRow } from "./brand-row";
import { CardList, CardListItem } from "@/components/mobile/list-card";
import { AddBrandForm } from "./add-brand-form";
import { InvitedBrandRow } from "./invited-brand-row";
import { RefreshButton } from "@/components/refresh-button";
import { Pagination } from "@/components/pagination";
import { sanitizeSearchTerm } from "@/lib/validation";
import { authIdsByPhone, brandIdsByContactPhone, listAllAuthUsers, phoneQueryDigits } from "@/lib/phone-search";
import { getTranslations } from "next-intl/server";
import { BrandTypeFilter } from "@/components/brand-type-filter";
import { BRAND_TYPE_PARAM, brandTypeFilter } from "@/lib/brand-account-type";
import { SortBar, SortLink } from "@/components/sort-controls";
import { applySort, resolveSort, type SortOption } from "@/lib/sorting";
import { platformsForUsers } from "@/lib/device-platforms";

const BASE = "/dashboard/brands";

// Kept short on purpose. There are SIX registered brands and 141
// invitations, so most columns here have one value or six distinct ones —
// a filter over that is decoration. These three earn their place: how the
// brand arrived, whether it has the GSTIN that verification depends on,
// and (on the invited tab, where the rows actually are) whether an
// invitation has been claimed, which nothing in the portal could show
// before.
const BRAND_SOURCES = ["direct_signup", "admin_invited"] as const;
const INVITE_STATUSES = ["pending", "claimed"] as const;

// Registered brands. `contact_phone` is sortable here (unlike the creator
// list) because brands store their own phone on the profile rather than
// only on auth.users.
function brandSorts(label: (k: string) => string): SortOption[] {
  const tiebreak = { column: "brand_id", ascending: true };
  return [
    { key: "recent", column: "updated_at", label: label("recent"), defaultDir: "desc", tiebreak },
    { key: "joined", column: "created_at", label: label("joined"), defaultDir: "desc", tiebreak },
    { key: "brandName", column: "brand_name", label: label("brandName"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "verification", column: "verification_status", label: label("verification"), defaultDir: "asc", tiebreak },
    { key: "contactNumber", column: "contact_phone", label: label("contactNumber"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "gstin", column: "gstin", label: label("gstin"), defaultDir: "asc", nullsLast: true, tiebreak },
  ];
}

const INVITES_PER_PAGE = 12;

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const t = await getTranslations("DashboardBrands");
  const filterFields = [
    { name: "search", label: t("filters.search"), type: "text" as const, placeholder: t("filters.searchPlaceholder") },
    {
      name: "verification",
      label: t("filters.verification"),
      type: "select" as const,
      options: [
        { label: t("filters.pending"), value: "pending" },
        { label: t("filters.verified"), value: "verified" },
        { label: t("filters.rejected"), value: "rejected" },
        { label: t("filters.notApplied"), value: "not_applied" },
      ],
    },
    { name: "source", label: t("filters.allSources"), type: "select" as const, options: BRAND_SOURCES.map((s) => ({ label: t(`source.${s}`), value: s })) },
    { name: "hasgst", label: t("filters.allGstin"), type: "select" as const, options: [{ label: t("gstin.yes"), value: "yes" }, { label: t("gstin.no"), value: "no" }] },
    { name: "istatus", label: t("filters.allInviteStatuses"), type: "select" as const, options: INVITE_STATUSES.map((s) => ({ label: t(`inviteStatus.${s}`), value: s })) },
  ];
  const params = await searchParams;
  const { search, verification, tab, invite_page } = params;
  const supabase = createAdminClient();
  const activeTab = tab || "all";
  const invitePage = Math.max(1, parseInt(invite_page || "1", 10) || 1);
  // Sanitize before it feeds a hand-built PostgREST .or() on the
  // service-role client (filter-injection guard).
  const searchTerm = sanitizeSearchTerm(search);
  // Brand / agency checkboxes (migration 075) — applies to both lists.
  const accountType = brandTypeFilter(params[BRAND_TYPE_PARAM]);
  // Validated against their allowlists before reaching a query.
  const source = (BRAND_SOURCES as readonly string[]).includes(params.source || "") ? params.source! : "";
  const hasgst = params.hasgst === "yes" || params.hasgst === "no" ? params.hasgst : "";
  const istatus = (INVITE_STATUSES as readonly string[]).includes(params.istatus || "") ? params.istatus! : "";
  const SORTS = brandSorts((k) => t(`sort.${k}`));
  // `recent` is the fallback, so a page with no ?sort keeps the
  // most-recently-updated-first order it had before sorting existed.
  const sort = resolveSort(params.sort, SORTS, "recent");

  // Fetch registered brands
  let brandQuery = supabase
    .from("brand_profiles")
    .select("brand_id, brand_name, logo_url, contact_phone, verification_status, gstin, instagram_username, account_type");
  brandQuery = applySort(brandQuery, sort);

  // A digits-only search also matches the brand's contact phone or the phone
  // they sign in with (auth.users). Invited brands have no phone stored, so
  // they only match by name/handle.
  const phoneQuery = phoneQueryDigits(search);
  let phoneBrandIds: string[] = [];
  if (phoneQuery) {
    const [byContact, authUsers] = await Promise.all([
      brandIdsByContactPhone(supabase, phoneQuery),
      listAllAuthUsers(supabase).catch(() => []),
    ]);
    phoneBrandIds = [...new Set([...byContact, ...authIdsByPhone(authUsers, phoneQuery)])];
  }

  if (searchTerm) {
    const clauses = [`brand_name.ilike.%${searchTerm}%`, `gstin.ilike.%${searchTerm}%`];
    // Auth ids include creators too; the IN filter only keeps real brand rows.
    if (phoneBrandIds.length > 0) clauses.push(`brand_id.in.(${phoneBrandIds.join(",")})`);
    brandQuery = brandQuery.or(clauses.join(","));
  }
  if (verification) {
    brandQuery = brandQuery.eq("verification_status", verification);
  }
  if (accountType) brandQuery = brandQuery.eq("account_type", accountType);
  if (source) brandQuery = brandQuery.eq("source", source);
  // GSTIN presence rather than its value: it is what verification turns on,
  // so "which brands can't be verified yet" is the real question.
  //
  // Empty string counts as absent. Three of the six rows store `''` rather
  // than NULL, so `.is("gstin", null)` alone reported zero brands without a
  // GSTIN while half of them have none — the filter looked like it worked.
  if (hasgst === "yes") brandQuery = brandQuery.not("gstin", "is", null).neq("gstin", "");
  else if (hasgst === "no") brandQuery = brandQuery.or("gstin.is.null,gstin.eq.");

  // Pending invitations — paginated. `count: exact` returns the matching
  // total so the page count is correct after filtering. Built before either
  // query is awaited so the two run together: each round trip goes to the
  // Mumbai project, so serialising them doubles the wait for nothing.
  const inviteFrom = (invitePage - 1) * INVITES_PER_PAGE;
  const inviteTo = inviteFrom + INVITES_PER_PAGE - 1;
  let inviteQuery = supabase
    .from("brand_invitations")
    .select("id, brand_name, instagram_username, logo_url, notes, status, created_at, account_type", { count: "exact" })
    // Pending by default, which is what this tab has always shown — but
    // claimed invitations were previously unreachable from the portal
    // entirely, so the filter can now ask for them.
    .eq("status", istatus || "pending")
    .order("created_at", { ascending: false })
    .range(inviteFrom, inviteTo);

  if (searchTerm) {
    inviteQuery = inviteQuery.or(`brand_name.ilike.%${searchTerm}%,instagram_username.ilike.%${searchTerm}%`);
  }
  if (accountType) inviteQuery = inviteQuery.eq("account_type", accountType);

  const [
    { data: brands, error: brandsError },
    { data: pendingInvites, error: invitesError, count: pendingInviteCount },
  ] = await Promise.all([brandQuery, inviteQuery]);
  const invitesTotal = pendingInviteCount ?? 0;
  const allCount = (brands?.length || 0) + invitesTotal;

  // Which platforms each brand signs in from. Only registered brands have
  // sessions — an invitation has no account behind it yet, so the invited
  // cards deliberately show nothing rather than an empty badge row.
  const platformMap = await platformsForUsers(
    supabase,
    (brands || []).map((b) => b.brand_id),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">{t("subtitle")}</p>
        </div>
        <RefreshButton />
      </div>

      <AddBrandForm />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl mb-6 w-fit">
        <TabLink label={t("tabs.all")} value="all" active={activeTab} count={allCount} />
        <TabLink label={t("tabs.registered")} value="registered" active={activeTab} count={brands?.length || 0} />
        <TabLink label={t("tabs.invited")} value="invited" active={activeTab} count={invitesTotal} />
      </div>

      <div className="mb-4">
        <BrandTypeFilter />
      </div>

      {/* Registered brands table — shown on "all" and "registered" tabs */}
      {(activeTab === "all" || activeTab === "registered") && (
        <>
          <FilterBar fields={filterFields} />
          {/* Cards have no headers to click, so this is the only way to
              reorder on a phone. */}
          <SortBar options={SORTS} current={sort} basePath={BASE} params={params} className="mb-4" />

          {brandsError && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
              {t("brandsLoadError", { message: brandsError.message })}
            </div>
          )}

          {/* Cards on phones, table from lg up. */}
          <CardList>
            {brands && brands.length > 0 ? (
              brands.map((brand) => (
                <CardListItem key={brand.brand_id}>
                  <BrandRow brand={brand} variant="card" platforms={platformMap.get(brand.brand_id)?.platforms} />
                </CardListItem>
              ))
            ) : (
              <li className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
                {t("noRegisteredBrands")}
              </li>
            )}
          </CardList>

          <div className="hidden lg:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full min-w-180">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  {(["brandName", "contactNumber", "verification", "gstin"] as const).map((c) => {
                    const option = SORTS.find((o) => o.key === c);
                    return (
                      <th
                        key={c}
                        className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5"
                      >
                        {option ? (
                          <SortLink option={option} current={sort} basePath={BASE} params={params} />
                        ) : (
                          t(`columns.${c}`)
                        )}
                      </th>
                    );
                  })}
                  {/* Not sortable: the platforms come from device_sessions,
                      which PostgREST cannot order this query by. */}
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.platforms")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {brands && brands.length > 0 ? (
                  brands.map((brand) => (
                    <BrandRow key={brand.brand_id} brand={brand} platforms={platformMap.get(brand.brand_id)?.platforms} />
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <p className="text-sm text-gray-400 dark:text-gray-500">{t("noRegisteredBrands")}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {/* Invited brands — shown on "all" and "invited" tabs */}
      {(activeTab === "all" || activeTab === "invited") && (
        <>
          {activeTab === "all" && pendingInvites && pendingInvites.length > 0 && (
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mt-8 mb-4">{t("pendingInvitations")}</h3>
          )}

          {invitesError && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
              {t("invitesLoadError", { message: invitesError.message })}
            </div>
          )}

          {pendingInvites && pendingInvites.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pendingInvites.map((invite) => (
                  <InvitedBrandRow key={invite.id} invitation={invite} />
                ))}
              </div>
              <Pagination
                basePath="/dashboard/brands"
                pageParam="invite_page"
                currentParams={params}
                page={invitePage}
                perPage={INVITES_PER_PAGE}
                total={invitesTotal}
              />
            </>
          ) : activeTab === "invited" ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("noPendingInvitations")}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("inviteHint")}</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TabLink({ label, value, active, count }: { label: string; value: string; active: string; count: number }) {
  return (
    <a
      href={`/dashboard/brands?tab=${value}`}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
        active === value
          ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
          active === value
            ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
            : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
        }`}>
          {count}
        </span>
      )}
    </a>
  );
}
