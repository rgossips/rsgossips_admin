import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { CreateCampaignForm, type CampaignInitial } from "../../create/create-campaign-form";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export const dynamic = "force-dynamic";

// Edit reuses the same form used for create. The page parses the
// description-tail metadata blob (banner / gallery / extended fields)
// back into a structured `initial` so the form can pre-fill its state.
// Keeping both flows on a single form is the whole reason it's worth
// the parse: divergent edit/create forms drift apart over time
// (e.g. the older modal didn't expose blogs, platforms, languages,
// content do's & don'ts, etc.).
export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminOrAbove())) redirect("/dashboard/campaigns");
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("campaign_id", id)
    .maybeSingle();
  if (!campaign) notFound();

  const { data: registeredBrands } = await supabase
    .from("brand_profiles")
    .select("brand_id, brand_name")
    .order("brand_name");
  const { data: invitedBrands } = await supabase
    .from("brand_invitations")
    .select("id, brand_name")
    .eq("status", "pending")
    .order("brand_name");

  const allBrands = [
    ...(registeredBrands || []).map((b) => ({ id: b.brand_id, name: b.brand_name, type: "registered" as const })),
    ...(invitedBrands || []).map((b) => ({ id: b.id, name: b.brand_name, type: "invited" as const })),
  ];

  // Strip the trailing "\n\n---\n{json}" metadata blob from the description.
  // Two flavours exist in the wild: legacy rows where the entire description
  // is a bare JSON object, and current rows where prose precedes a separator.
  let description: string = campaign.description || "";
  let meta: Record<string, any> = {};
  const sep = description.indexOf("\n\n---\n");
  if (sep !== -1) {
    try { meta = JSON.parse(description.slice(sep + 5)); } catch {}
    description = description.slice(0, sep);
  } else if (description.startsWith("{")) {
    try { meta = JSON.parse(description); description = ""; } catch {}
  }

  const deliverables: Record<string, number> = {};
  for (const entry of campaign.content_types_required || []) {
    const [type, count] = entry.split(":");
    if (type && count) deliverables[type] = parseInt(count);
  }

  const initial: CampaignInitial = {
    campaign_id: campaign.campaign_id,
    title: campaign.title || "",
    description,
    brand_id: campaign.brand_id,
    brand_invitation_id: campaign.brand_invitation_id,
    status: campaign.status || "draft",
    campaign_type: (campaign.campaign_type as "barter" | "paid" | "hybrid") || "barter",
    max_influencers: campaign.max_influencers,
    budget_total: campaign.budget_total,
    target_follower_min: campaign.target_follower_min,
    target_follower_max: campaign.target_follower_max,
    target_influencer_tier: campaign.target_influencer_tier,
    target_categories: campaign.target_categories,
    target_cities: campaign.target_cities,
    campaign_start_date: campaign.campaign_start_date,
    campaign_end_date: campaign.campaign_end_date,
    application_deadline: campaign.application_deadline,
    deliverables,
    banner_image: meta.banner_image || null,
    gallery_images: Array.isArray(meta.gallery_images) ? meta.gallery_images : [],
    min_engagement_rate: typeof meta.min_engagement_rate === "number" ? meta.min_engagement_rate : null,
    platforms: Array.isArray(meta.platforms) ? meta.platforms : [],
    target_gender: Array.isArray(meta.target_gender) ? meta.target_gender : [],
    target_languages: Array.isArray(meta.target_languages) ? meta.target_languages : [],
    offering_type: meta.offering_type === "service" ? "service" : meta.offering_type === "product" ? "product" : null,
    product_name: meta.product_name || "",
    product_value: typeof meta.product_value === "number" ? meta.product_value : null,
    shipping_required: meta.shipping_required || "",
    shipping_timeline_days: typeof meta.shipping_timeline_days === "number" ? meta.shipping_timeline_days : null,
    service_location: meta.service_location || "",
    barter_compensation: meta.barter_compensation || "",
    content_dos: meta.content_dos || "",
    content_donts: meta.content_donts || "",
    required_hashtags: meta.required_hashtags || "",
    brand_handles_to_tag: meta.brand_handles_to_tag || "",
    usage_rights: meta.usage_rights || "",
    keepup_duration: meta.keepup_duration || "",
    exclusivity_days: meta.exclusivity_days ? String(meta.exclusivity_days) : "",
    payment_timeline: meta.payment_timeline || "",
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link
          href={`/dashboard/campaigns/${id}`}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Campaign</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">{campaign.title || "Untitled campaign"}</p>
        </div>
      </div>

      <CreateCampaignForm brands={allBrands} initial={initial} />
    </div>
  );
}
