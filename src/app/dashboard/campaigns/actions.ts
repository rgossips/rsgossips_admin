"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { adminGate, superAdminGate } from "@/lib/require-super-admin";

export async function uploadCampaignImage(formData: FormData): Promise<{ error?: string; url?: string }> {
  const gate = await adminGate();
  if (gate) return gate;

  const file = formData.get("file") as File | null;
  const folder = (formData.get("folder") as string) || "misc";

  if (!file || file.size === 0) return { error: "No file provided" };
  if (!file.type.startsWith("image/")) return { error: "Only images are allowed" };
  if (file.size > 5 * 1024 * 1024) return { error: "File must be under 5MB" };

  const adminClient = createAdminClient();
  const timestamp = Date.now();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${folder}/${timestamp}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error } = await adminClient.storage
    .from("campaign-images")
    .upload(path, Buffer.from(arrayBuffer), {
      contentType: file.type,
      upsert: true,
    });

  if (error) return { error: error.message };

  const { data } = adminClient.storage.from("campaign-images").getPublicUrl(path);
  return { url: data.publicUrl };
}

export async function createCampaign(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const brandId = formData.get("brand_id") as string;
  const category = formData.getAll("category") as string[];
  const maxInfluencers = formData.get("max_influencers") as string;
  const startDate = formData.get("campaign_start_date") as string;
  const endDate = formData.get("campaign_end_date") as string;
  const deadline = formData.get("application_deadline") as string;
  const campaignType = formData.get("campaign_type") as string;
  const budgetTotal = formData.get("budget_total") as string;
  const budgetPerInfluencer = formData.get("budget_per_influencer") as string;
  const followerMax = formData.get("target_follower_max") as string;
  const influencerTier = formData.get("target_influencer_tier") as string;

  // Content deliverables
  const reels = formData.get("num_reels") as string;
  const posts = formData.get("num_posts") as string;
  const stories = formData.get("num_stories") as string;
  const videos = formData.get("num_videos") as string;
  const blogs = formData.get("num_blogs") as string;

  // Requirements
  const minFollowers = formData.get("target_follower_min") as string;
  const minEngagement = formData.get("min_engagement_rate") as string;
  const targetCities = formData.get("target_cities") as string;

  // Image URLs (uploaded client-side to Supabase Storage)
  const bannerUrl = formData.get("banner_image_url") as string | null;
  const galleryUrls = formData.getAll("gallery_image_urls") as string[];

  // Audit / extended fields
  const offeringType = formData.get("offering_type") as string;
  const productName = formData.get("product_name") as string;
  const productValue = formData.get("product_value") as string;
  const shippingRequired = formData.get("shipping_required") as string;
  const shippingTimelineDays = formData.get("shipping_timeline_days") as string;
  const serviceLocation = formData.get("service_location") as string;
  const barterCompensation = formData.get("barter_compensation") as string;
  const contentDos = formData.get("content_dos") as string;
  const contentDonts = formData.get("content_donts") as string;
  const requiredHashtags = formData.get("required_hashtags") as string;
  const brandHandlesToTag = formData.get("brand_handles_to_tag") as string;
  const usageRights = formData.get("usage_rights") as string;
  const keepupDuration = formData.get("keepup_duration") as string;
  const exclusivityDays = formData.get("exclusivity_days") as string;
  const paymentTimeline = formData.get("payment_timeline") as string;
  const platformsJson = formData.get("platforms_json") as string;
  const gendersJson = formData.get("genders_json") as string;
  const languagesJson = formData.get("languages_json") as string;

  const safeJsonArr = (raw: string) => {
    try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const platforms = safeJsonArr(platformsJson);
  const genders = safeJsonArr(gendersJson);
  const languages = safeJsonArr(languagesJson);

  if (!title) return { error: "Title is required" };
  if (!brandId) return { error: "Brand is required" };
  if (!startDate) return { error: "Start date is required" };
  if (!deadline) return { error: "Application deadline is required" };
  if (!endDate) return { error: "Campaign end date is required" };
  // Reject unparseable dates BEFORE comparing — a NaN date makes every
  // `>` comparison false, so a garbage date would otherwise slip through.
  if ([startDate, deadline, endDate].some((d) => Number.isNaN(new Date(d).getTime()))) {
    return { error: "One of the dates is invalid." };
  }
  if (new Date(startDate) > new Date(endDate)) {
    return { error: "Campaign start date must be on or before the end date." };
  }
  if (new Date(deadline) > new Date(endDate)) {
    return { error: "Application deadline must be on or before the campaign end date" };
  }
  const finalDeadline = deadline;

  // Parse brand selection — format is "type:id" (e.g. "registered:uuid" or "invited:uuid")
  const [brandType, brandUuid] = brandId.includes(":") ? brandId.split(":", 2) : ["registered", brandId];

  const adminClient = createAdminClient();

  // Build content_types_required as a structured array
  const contentTypes: string[] = [];
  if (reels && parseInt(reels) > 0) contentTypes.push(`reels:${reels}`);
  if (posts && parseInt(posts) > 0) contentTypes.push(`posts:${posts}`);
  if (stories && parseInt(stories) > 0) contentTypes.push(`stories:${stories}`);
  if (videos && parseInt(videos) > 0) contentTypes.push(`videos:${videos}`);
  if (blogs && parseInt(blogs) > 0) contentTypes.push(`blogs:${blogs}`);

  // Build description with metadata if any extras provided
  let fullDescription = description || "";
  const metadata: Record<string, unknown> = {};
  if (bannerUrl) metadata.banner_image = bannerUrl;
  const validGalleryUrls = galleryUrls.filter(Boolean);
  if (validGalleryUrls.length > 0) metadata.gallery_images = validGalleryUrls;
  if (minEngagement) metadata.min_engagement_rate = parseFloat(minEngagement);

  // Extended audit fields
  if (platforms.length > 0) metadata.platforms = platforms;
  if (genders.length > 0) metadata.target_gender = genders;
  if (languages.length > 0) metadata.target_languages = languages;
  if (offeringType) metadata.offering_type = offeringType;
  if (productName) metadata.product_name = productName;
  if (productValue) metadata.product_value = parseInt(productValue);
  // Shipping fields only apply to product offerings; service uses service_location.
  if (offeringType === "product") {
    if (shippingRequired) metadata.shipping_required = shippingRequired;
    if (shippingTimelineDays) metadata.shipping_timeline_days = parseInt(shippingTimelineDays);
  } else if (offeringType === "service") {
    if (serviceLocation) metadata.service_location = serviceLocation;
  }
  if (barterCompensation) metadata.barter_compensation = barterCompensation;
  if (contentDos) metadata.content_dos = contentDos;
  if (contentDonts) metadata.content_donts = contentDonts;
  if (requiredHashtags) metadata.required_hashtags = requiredHashtags;
  if (brandHandlesToTag) metadata.brand_handles_to_tag = brandHandlesToTag;
  if (usageRights) metadata.usage_rights = usageRights;
  if (keepupDuration) metadata.keepup_duration = keepupDuration;
  if (exclusivityDays && exclusivityDays !== "0") metadata.exclusivity_days = exclusivityDays;
  if (paymentTimeline) metadata.payment_timeline = paymentTimeline;

  if (Object.keys(metadata).length > 0) {
    fullDescription = fullDescription
      ? `${fullDescription}\n\n---\n${JSON.stringify(metadata)}`
      : JSON.stringify(metadata);
  }

  const cities = targetCities
    ? targetCities.split(",").map((c) => c.trim()).filter(Boolean)
    : ["All India"];

  const { error } = await adminClient.from("campaigns").insert({
    brand_id: brandType === "registered" ? brandUuid : null,
    brand_invitation_id: brandType === "invited" ? brandUuid : null,
    created_by_admin: true,
    title,
    description: fullDescription || title,
    campaign_type: campaignType || "barter",
    target_categories: category.length > 0 ? category : ["General"],
    max_influencers: maxInfluencers ? parseInt(maxInfluencers) : 10,
    campaign_start_date: startDate,
    campaign_end_date: endDate,
    application_deadline: finalDeadline,
    content_types_required: contentTypes.length > 0 ? contentTypes : ["reels"],
    budget_total: budgetTotal ? parseInt(budgetTotal) : 0,
    budget_per_influencer: budgetPerInfluencer ? parseInt(budgetPerInfluencer) : 0,
    target_follower_min: minFollowers ? parseInt(minFollowers) : 0,
    target_follower_max: followerMax ? parseInt(followerMax) : 1000000,
    target_influencer_tier: influencerTier || "all",
    target_cities: cities,
    status: "draft",
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

export async function updateApplicationStatus(
  applicationId: string,
  newStatus: string,
  rejectionReason?: string,
  agreedRate?: number,
  _approvalNote?: string,
  revisionNote?: string,
  revisionLinks?: string[],
): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const adminClient = createAdminClient();
  const updates: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (rejectionReason) updates.rejection_reason = rejectionReason;
  if (agreedRate && newStatus === "approved") updates.final_agreed_rate = agreedRate;
  if (newStatus === "revision_needed" && (revisionNote || revisionLinks)) {
    updates.rejection_reason = JSON.stringify({ note: revisionNote || "", links: revisionLinks || [] });
  }

  const { error } = await adminClient.from("campaign_applications").update(updates).eq("id", applicationId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

export async function updateCampaignStatus(campaignId: string, status: string): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("campaigns").update({ status }).eq("campaign_id", campaignId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

// Mirrors createCampaign field-by-field so the same client form can drive
// both. The only differences from create: we accept a brand change but
// don't require it (`brand_id` is optional here), we honour an explicit
// `status` field, and we update by campaign_id instead of inserting.
export async function updateCampaign(campaignId: string, formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const brandId = formData.get("brand_id") as string | null;
  const category = formData.getAll("category") as string[];
  const maxInfluencers = formData.get("max_influencers") as string;
  const startDate = formData.get("campaign_start_date") as string;
  const endDate = formData.get("campaign_end_date") as string;
  const deadline = formData.get("application_deadline") as string;
  const campaignType = formData.get("campaign_type") as string;
  const budgetTotal = formData.get("budget_total") as string;
  const budgetPerInfluencer = formData.get("budget_per_influencer") as string;
  const followerMax = formData.get("target_follower_max") as string;
  const influencerTier = formData.get("target_influencer_tier") as string;
  const status = formData.get("status") as string;

  const reels = formData.get("num_reels") as string;
  const posts = formData.get("num_posts") as string;
  const stories = formData.get("num_stories") as string;
  const videos = formData.get("num_videos") as string;
  const blogs = formData.get("num_blogs") as string;

  const minFollowers = formData.get("target_follower_min") as string;
  const minEngagement = formData.get("min_engagement_rate") as string;
  const targetCities = formData.get("target_cities") as string;

  const bannerUrl = formData.get("banner_image_url") as string | null;
  const galleryUrls = formData.getAll("gallery_image_urls") as string[];

  const offeringType = formData.get("offering_type") as string;
  const productName = formData.get("product_name") as string;
  const productValue = formData.get("product_value") as string;
  const shippingRequired = formData.get("shipping_required") as string;
  const shippingTimelineDays = formData.get("shipping_timeline_days") as string;
  const serviceLocation = formData.get("service_location") as string;
  const barterCompensation = formData.get("barter_compensation") as string;
  const contentDos = formData.get("content_dos") as string;
  const contentDonts = formData.get("content_donts") as string;
  const requiredHashtags = formData.get("required_hashtags") as string;
  const brandHandlesToTag = formData.get("brand_handles_to_tag") as string;
  const usageRights = formData.get("usage_rights") as string;
  const keepupDuration = formData.get("keepup_duration") as string;
  const exclusivityDays = formData.get("exclusivity_days") as string;
  const paymentTimeline = formData.get("payment_timeline") as string;
  const platformsJson = formData.get("platforms_json") as string;
  const gendersJson = formData.get("genders_json") as string;
  const languagesJson = formData.get("languages_json") as string;

  const safeJsonArr = (raw: string) => {
    try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const platforms = safeJsonArr(platformsJson);
  const genders = safeJsonArr(gendersJson);
  const languages = safeJsonArr(languagesJson);

  if (!title) return { error: "Title is required" };
  if (deadline && endDate && new Date(deadline) > new Date(endDate)) {
    return { error: "Application deadline must be on or before the campaign end date" };
  }

  const contentTypes: string[] = [];
  if (reels && parseInt(reels) > 0) contentTypes.push(`reels:${reels}`);
  if (posts && parseInt(posts) > 0) contentTypes.push(`posts:${posts}`);
  if (stories && parseInt(stories) > 0) contentTypes.push(`stories:${stories}`);
  if (videos && parseInt(videos) > 0) contentTypes.push(`videos:${videos}`);
  if (blogs && parseInt(blogs) > 0) contentTypes.push(`blogs:${blogs}`);

  let fullDescription = description || "";
  const metadata: Record<string, unknown> = {};
  if (bannerUrl) metadata.banner_image = bannerUrl;
  const validGalleryUrls = galleryUrls.filter(Boolean);
  if (validGalleryUrls.length > 0) metadata.gallery_images = validGalleryUrls;
  if (minEngagement) metadata.min_engagement_rate = parseFloat(minEngagement);
  if (platforms.length > 0) metadata.platforms = platforms;
  if (genders.length > 0) metadata.target_gender = genders;
  if (languages.length > 0) metadata.target_languages = languages;
  if (offeringType) metadata.offering_type = offeringType;
  if (productName) metadata.product_name = productName;
  if (productValue) metadata.product_value = parseInt(productValue);
  if (offeringType === "product") {
    if (shippingRequired) metadata.shipping_required = shippingRequired;
    if (shippingTimelineDays) metadata.shipping_timeline_days = parseInt(shippingTimelineDays);
  } else if (offeringType === "service") {
    if (serviceLocation) metadata.service_location = serviceLocation;
  }
  if (barterCompensation) metadata.barter_compensation = barterCompensation;
  if (contentDos) metadata.content_dos = contentDos;
  if (contentDonts) metadata.content_donts = contentDonts;
  if (requiredHashtags) metadata.required_hashtags = requiredHashtags;
  if (brandHandlesToTag) metadata.brand_handles_to_tag = brandHandlesToTag;
  if (usageRights) metadata.usage_rights = usageRights;
  if (keepupDuration) metadata.keepup_duration = keepupDuration;
  if (exclusivityDays && exclusivityDays !== "0") metadata.exclusivity_days = exclusivityDays;
  if (paymentTimeline) metadata.payment_timeline = paymentTimeline;

  if (Object.keys(metadata).length > 0) {
    fullDescription = fullDescription
      ? `${fullDescription}\n\n---\n${JSON.stringify(metadata)}`
      : JSON.stringify(metadata);
  }

  const cities = targetCities
    ? targetCities.split(",").map((c) => c.trim()).filter(Boolean)
    : ["All India"];

  const updates: Record<string, unknown> = {
    title,
    description: fullDescription || title,
    campaign_type: campaignType || "barter",
    max_influencers: maxInfluencers ? parseInt(maxInfluencers) : 10,
    content_types_required: contentTypes.length > 0 ? contentTypes : ["reels"],
    budget_total: budgetTotal ? parseInt(budgetTotal) : 0,
    budget_per_influencer: budgetPerInfluencer ? parseInt(budgetPerInfluencer) : 0,
    target_follower_min: minFollowers ? parseInt(minFollowers) : 0,
    target_follower_max: followerMax ? parseInt(followerMax) : 1000000,
    target_influencer_tier: influencerTier || "all",
    target_cities: cities,
    target_categories: category.length > 0 ? category : ["General"],
    updated_at: new Date().toISOString(),
  };
  if (startDate) updates.campaign_start_date = startDate;
  if (endDate) updates.campaign_end_date = endDate;
  if (deadline) updates.application_deadline = deadline;
  if (status) updates.status = status;

  // Optional brand reassignment. We allow it because the inline edit
  // route lets admins fix a mis-attributed campaign.
  if (brandId) {
    const [brandType, brandUuid] = brandId.includes(":") ? brandId.split(":", 2) : ["registered", brandId];
    if (brandType === "registered") {
      updates.brand_id = brandUuid;
      updates.brand_invitation_id = null;
    } else if (brandType === "invited") {
      updates.brand_id = null;
      updates.brand_invitation_id = brandUuid;
    }
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("campaigns").update(updates).eq("campaign_id", campaignId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

// Bulk-delete campaigns. Super admin only — destructive and cascades into
// campaign_applications (otherwise the FK would block the delete). Also
// nukes any featured_campaigns rows so the home carousel doesn't render
// a deleted campaign.
export async function deleteCampaigns(campaignIds: string[]): Promise<{ error?: string; deleted?: number }> {
  const gate = await superAdminGate();
  if (gate) return gate;

  const ids = (campaignIds || []).filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return { error: "No campaigns selected" };

  const adminClient = createAdminClient();

  // Applications reference campaigns by FK, so drop them first.
  const { error: appsErr } = await adminClient
    .from("campaign_applications")
    .delete()
    .in("campaign_id", ids);
  if (appsErr) return { error: `Failed to remove applications: ${appsErr.message}` };

  // Featured listings reference campaigns too — best-effort, swallow
  // errors so a missing/empty table doesn't block the actual delete.
  try {
    await adminClient.from("featured_campaigns").delete().in("campaign_id", ids);
  } catch { /* non-fatal */ }

  const { error, count } = await adminClient
    .from("campaigns")
    .delete({ count: "exact" })
    .in("campaign_id", ids);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/campaigns");
  return { deleted: count ?? ids.length };
}
