import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { CampaignRow } from "./campaign-row";
import { CampaignFilters } from "./campaign-filters";
import { RefreshButton } from "@/components/refresh-button";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { search, status, category } = await searchParams;
  const supabase = createAdminClient();
  const canWrite = await isAdminOrAbove();

  let query = supabase
    .from("campaigns")
    .select("campaign_id, title, status, max_influencers, campaign_start_date, campaign_end_date, target_categories, brand_id, brand_invitation_id, created_by_admin, brand_profiles(brand_name), brand_invitations(brand_name)")
    .order("created_at", { ascending: false });

  if (search) {
    query = query.ilike("title", `%${search}%`);
  }
  if (status) {
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Campaigns</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">
            Track and manage influencer campaigns
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
              New Campaign
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <CampaignFilters />

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
          Failed to load campaigns: {error.message}
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
          {totalCount} campaign{totalCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">
                Title
              </th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">
                Brand
              </th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">
                Status
              </th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">
                Slots
              </th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">
                Dates
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {campaigns && campaigns.length > 0 ? (
              campaigns.map((campaign: any) => (
                <CampaignRow key={campaign.campaign_id} campaign={campaign} />
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-16 text-center"
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No campaigns found</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Try adjusting your filters or create a new campaign</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
