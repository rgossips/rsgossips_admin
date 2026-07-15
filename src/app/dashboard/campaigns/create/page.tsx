import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { CreateCampaignForm } from "./create-campaign-form";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export default async function CreateCampaignPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/campaigns");
  const t = await getTranslations("DashboardCampaignsCreate");
  const supabase = createAdminClient();

  // Fetch registered brands
  const { data: registeredBrands } = await supabase
    .from("brand_profiles")
    .select("brand_id, brand_name")
    .order("brand_name");

  // Fetch invited (unregistered) brands
  const { data: invitedBrands } = await supabase
    .from("brand_invitations")
    .select("id, brand_name")
    .eq("status", "pending")
    .order("brand_name");

  // Merge into one list with type indicator
  const allBrands = [
    ...(registeredBrands || []).map((b) => ({ id: b.brand_id, name: b.brand_name, type: "registered" as const })),
    ...(invitedBrands || []).map((b) => ({ id: b.id, name: b.brand_name, type: "invited" as const })),
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/dashboard/campaigns"
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">{t("subtitle")}</p>
        </div>
      </div>

      <CreateCampaignForm brands={allBrands} />
    </div>
  );
}
