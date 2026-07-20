import { createAdminClient } from "@/utils/supabase/admin";
import { FilterBar } from "@/components/filter-bar";
import { BrandRow } from "./brand-row";
import { AddBrandForm } from "./add-brand-form";
import { InvitedBrandRow } from "./invited-brand-row";
import { RefreshButton } from "@/components/refresh-button";
import { Pagination } from "@/components/pagination";
import { sanitizeSearchTerm } from "@/lib/validation";
import { getTranslations } from "next-intl/server";

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
  ];
  const params = await searchParams;
  const { search, verification, tab, invite_page } = params;
  const supabase = createAdminClient();
  const activeTab = tab || "all";
  const invitePage = Math.max(1, parseInt(invite_page || "1", 10) || 1);
  // Sanitize before it feeds a hand-built PostgREST .or() on the
  // service-role client (filter-injection guard).
  const searchTerm = sanitizeSearchTerm(search);

  // Fetch registered brands
  let brandQuery = supabase
    .from("brand_profiles")
    .select("brand_id, brand_name, logo_url, contact_phone, verification_status, gstin, instagram_username")
    .order("updated_at", { ascending: false });

  if (searchTerm) {
    brandQuery = brandQuery.or(`brand_name.ilike.%${searchTerm}%,gstin.ilike.%${searchTerm}%`);
  }
  if (verification) {
    brandQuery = brandQuery.eq("verification_status", verification);
  }

  const { data: brands, error: brandsError } = await brandQuery;

  // Fetch only pending invitations — paginated. `count: exact` returns
  // the matching total so the page count is correct after filtering.
  const inviteFrom = (invitePage - 1) * INVITES_PER_PAGE;
  const inviteTo = inviteFrom + INVITES_PER_PAGE - 1;
  let inviteQuery = supabase
    .from("brand_invitations")
    .select("id, brand_name, instagram_username, logo_url, notes, status, created_at", { count: "exact" })
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .range(inviteFrom, inviteTo);

  if (searchTerm) {
    inviteQuery = inviteQuery.or(`brand_name.ilike.%${searchTerm}%,instagram_username.ilike.%${searchTerm}%`);
  }

  const { data: pendingInvites, error: invitesError, count: pendingInviteCount } = await inviteQuery;
  const invitesTotal = pendingInviteCount ?? 0;
  const allCount = (brands?.length || 0) + invitesTotal;

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

      {/* Registered brands table — shown on "all" and "registered" tabs */}
      {(activeTab === "all" || activeTab === "registered") && (
        <>
          <FilterBar fields={filterFields} />

          {brandsError && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
              {t("brandsLoadError", { message: brandsError.message })}
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full min-w-180">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.brandName")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.contactNumber")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.verification")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.gstin")}</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {brands && brands.length > 0 ? (
                  brands.map((brand) => (
                    <BrandRow key={brand.brand_id} brand={brand} />
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
