import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { CampaignsTable } from "./campaigns-table";
import { CampaignFilters } from "./campaign-filters";
import { RefreshButton } from "@/components/refresh-button";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { sanitizeSearchTerm } from "@/lib/validation";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { search, status, category } = await searchParams;
  const t = await getTranslations("DashboardCampaigns");
  const supabase = createAdminClient();
  const canWrite = await isAdminOrAbove();
  const searchTerm = sanitizeSearchTerm(search);

  let query = supabase
    .from("campaigns")
    .select("campaign_id, title, status, max_influencers, campaign_start_date, campaign_end_date, application_deadline, target_categories, brand_id, brand_invitation_id, created_by_admin, brand_profiles(brand_name), brand_invitations(brand_name)")
    .order("created_at", { ascending: false });

  if (searchTerm) {
    query = query.ilike("title", `%${searchTerm}%`);
  }
  if (status === "apps_closed") {
    // "Applications Closed" isn't a DB status — it's active campaigns whose
    // application window has lapsed. `.lt` on a timestamp excludes NULL
    // deadlines, so this matches the badge's rule (active + deadline in the
    // past) exactly.
    query = query.eq("status", "active").lt("application_deadline", new Date().toISOString());
  } else if (status) {
    query = query.eq("status", status);
  }
  if (category) {
    const cats = category.split(",").filter(Boolean);
    if (cats.length > 0) {
      query = query.contains("target_categories", cats);
    }
  }

  const { data: campaigns, error } = await query;

  const totalCount = campaigns?.length ?? 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton />
          {canWrite && (
            <Link
              href="/dashboard/campaigns/create"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-200/50 dark:shadow-indigo-900/30"
            >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
              {t("newCampaign")}
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <CampaignFilters />

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
          {t("loadError", { message: error.message })}
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
          {t("count", { count: totalCount })}
        </span>
      </div>

      {/* Table — checkboxes + bulk delete appear for super admins only */}
      <CampaignsTable campaigns={(campaigns as any[]) ?? []} />
    </div>
  );
}
