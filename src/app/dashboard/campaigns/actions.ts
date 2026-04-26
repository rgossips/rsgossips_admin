"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

export async function uploadCampaignImage(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

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

export async function createCampaign(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

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

  // Requirements
  const minFollowers = formData.get("target_follower_min") as string;
  const minEngagement = formData.get("min_engagement_rate") as string;
  const targetCities = formData.get("target_cities") as string;

  // Image URLs (uploaded client-side to Supabase Storage)
  const bannerUrl = formData.get("banner_image_url") as string | null;
  const galleryUrls = formData.getAll("gallery_image_urls") as string[];

  if (!title) return { error: "Title is required" };
  if (!brandId) return { error: "Brand is required" };
  if (!startDate) return { error: "Start date is required" };
  if (!endDate) return { error: "Deadline is required" };
  // Single deadline: applications close and the campaign ends on the same date.
  // We still write to both DB columns for backward compatibility with any
  // reader still consuming application_deadline.
  const finalDeadline = deadline || endDate;

  // Parse brand selection — format is "type:id" (e.g. "registered:uuid" or "invited:uuid")
  const [brandType, brandUuid] = brandId.includes(":") ? brandId.split(":", 2) : ["registered", brandId];

  const adminClient = createAdminClient();

  // Build content_types_required as a structured array
  const contentTypes: string[] = [];
  if (reels && parseInt(reels) > 0) contentTypes.push(`reels:${reels}`);
  if (posts && parseInt(posts) > 0) contentTypes.push(`posts:${posts}`);
  if (stories && parseInt(stories) > 0) contentTypes.push(`stories:${stories}`);
  if (videos && parseInt(videos) > 0) contentTypes.push(`videos:${videos}`);

  // Build description with metadata (banner + gallery URLs) if images were uploaded
  let fullDescription = description || "";
  const metadata: Record<string, unknown> = {};
  if (bannerUrl) metadata.banner_image = bannerUrl;
  const validGalleryUrls = galleryUrls.filter(Boolean);
  if (validGalleryUrls.length > 0) metadata.gallery_images = validGalleryUrls;
  if (minEngagement) metadata.min_engagement_rate = parseFloat(minEngagement);
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
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

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

export async function updateCampaignStatus(campaignId: string, status: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("campaigns").update({ status }).eq("campaign_id", campaignId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

export async function updateCampaign(campaignId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const campaignType = formData.get("campaign_type") as string;
  const maxInfluencers = formData.get("max_influencers") as string;
  const startDate = formData.get("campaign_start_date") as string;
  const endDate = formData.get("campaign_end_date") as string;
  const deadline = formData.get("application_deadline") as string;
  const budgetTotal = formData.get("budget_total") as string;
  const budgetPerInfluencer = formData.get("budget_per_influencer") as string;
  const minFollowers = formData.get("target_follower_min") as string;
  const followerMax = formData.get("target_follower_max") as string;
  const influencerTier = formData.get("target_influencer_tier") as string;
  const targetCities = formData.get("target_cities") as string;
  const status = formData.get("status") as string;
  const categories = formData.getAll("category") as string[];
  const reels = formData.get("num_reels") as string;
  const posts = formData.get("num_posts") as string;
  const stories = formData.get("num_stories") as string;
  const videos = formData.get("num_videos") as string;
  const bannerUrl = formData.get("banner_image_url") as string | null;
  const galleryUrlsNew = formData.getAll("gallery_image_urls") as string[];
  const existingGallery = formData.get("existing_gallery") as string;
  const minEngagement = formData.get("min_engagement_rate") as string;

  if (!title) return { error: "Title is required" };

  const contentTypes: string[] = [];
  if (reels && parseInt(reels) > 0) contentTypes.push(`reels:${reels}`);
  if (posts && parseInt(posts) > 0) contentTypes.push(`posts:${posts}`);
  if (stories && parseInt(stories) > 0) contentTypes.push(`stories:${stories}`);
  if (videos && parseInt(videos) > 0) contentTypes.push(`videos:${videos}`);

  let fullDescription = description || "";
  const metadata: Record<string, unknown> = {};
  if (bannerUrl) metadata.banner_image = bannerUrl;
  const allGallery = [
    ...(existingGallery ? existingGallery.split(",").filter(Boolean) : []),
    ...galleryUrlsNew.filter(Boolean),
  ];
  if (allGallery.length > 0) metadata.gallery_images = allGallery;
  if (minEngagement) metadata.min_engagement_rate = parseFloat(minEngagement);
  if (Object.keys(metadata).length > 0) {
    fullDescription = fullDescription ? `${fullDescription}\n\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
  }

  const cities = targetCities ? targetCities.split(",").map((c) => c.trim()).filter(Boolean) : ["All India"];
  const adminClient = createAdminClient();
  const updates: Record<string, unknown> = {
    title, description: fullDescription || title, campaign_type: campaignType || "barter",
    max_influencers: maxInfluencers ? parseInt(maxInfluencers) : 10,
    content_types_required: contentTypes.length > 0 ? contentTypes : ["reels"],
    budget_total: budgetTotal ? parseInt(budgetTotal) : 0,
    budget_per_influencer: budgetPerInfluencer ? parseInt(budgetPerInfluencer) : 0,
    target_follower_min: minFollowers ? parseInt(minFollowers) : 0,
    target_follower_max: followerMax ? parseInt(followerMax) : 1000000,
    target_influencer_tier: influencerTier || "all",
    target_cities: cities, target_categories: categories.length > 0 ? categories : ["General"],
    updated_at: new Date().toISOString(),
  };
  if (startDate) updates.campaign_start_date = startDate;
  if (endDate) {
    updates.campaign_end_date = endDate;
    // Mirror to application_deadline so the two stay consistent
    updates.application_deadline = endDate;
  }
  if (deadline && !endDate) updates.application_deadline = deadline;
  if (status) updates.status = status;

  const { error } = await adminClient.from("campaigns").update(updates).eq("campaign_id", campaignId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  revalidatePath("/dashboard/campaigns");
  return { success: true };
}
