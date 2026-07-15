"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

// Used to be an inline modal with its own form that drifted from the
// create-campaign form. Now it just links to the shared form on the
// edit route — see [[edit-campaign-page]]. Props are kept so callers
// in [id]/page.tsx don't have to change.
export function EditCampaignButton({ campaign }: {
  campaign: { campaign_id: string };
  // Legacy props from the old modal — ignored. Kept so existing
  // callers compile without churn while we trim usage.
  description?: string;
  bannerUrl?: string | null;
  galleryUrls?: string[];
  engagementRate?: number | null;
  deliverables?: Record<string, number>;
}) {
  const t = useTranslations("DashboardCampaignsIdEditCampaign");
  return (
    <Link
      href={`/dashboard/campaigns/${campaign.campaign_id}/edit`}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors cursor-pointer"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      {t("edit")}
    </Link>
  );
}
