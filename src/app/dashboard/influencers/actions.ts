"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

export async function toggleInfluencerStatus(influencerId: string, currentStatus: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const newStatus = currentStatus === "active" ? "suspended" : "active";
  const adminClient = createAdminClient();
  const { error } = await adminClient.from("influencer_profiles").update({ status: newStatus }).eq("influencer_id", influencerId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/influencers");
  return { success: true, newStatus };
}

export async function updateInfluencer(influencerId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const updates: Record<string, unknown> = {};
  const fields = ["full_name", "username", "instagram_handle", "email", "bio", "city_id", "location", "status", "verification_status", "tier", "gender", "date_of_birth"];
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null) updates[f] = (v as string) || null;
  }
  // Handle categories as comma-separated
  const cats = formData.get("categories") as string;
  if (cats !== null) updates.categories = cats ? cats.split(",").map((c) => c.trim()).filter(Boolean) : [];
  updates.updated_at = new Date().toISOString();

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("influencer_profiles").update(updates).eq("influencer_id", influencerId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/influencers/${influencerId}`);
  revalidatePath("/dashboard/influencers");
  return { success: true };
}

export async function uploadInfluencerPhoto(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file" };
  if (!file.type.startsWith("image/")) return { error: "Only images allowed" };

  const adminClient = createAdminClient();
  await adminClient.storage.createBucket("influencer-photos", { public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] });

  const path = `photos/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${file.name.split(".").pop() || "jpg"}`;
  const { error } = await adminClient.storage.from("influencer-photos").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (error) return { error: error.message };

  const { data } = adminClient.storage.from("influencer-photos").getPublicUrl(path);
  return { url: data.publicUrl };
}

export async function inviteInfluencer(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const fullName = formData.get("full_name") as string;
  const instagramUsername = (formData.get("instagram_username") as string)?.replace(/^@/, "").trim();
  const profilePhotoUrl = (formData.get("profile_photo_url") as string) || "";
  const notesText = (formData.get("notes") as string) || "";
  const city = (formData.get("city") as string) || "";
  const gender = (formData.get("gender") as string) || "";
  const categories = formData.getAll("categories") as string[];
  const languages = formData.getAll("languages") as string[];
  const tags = formData.getAll("tags") as string[];

  if (!fullName) return { error: "Name is required" };
  if (!instagramUsername) return { error: "Instagram username is required" };
  if (!city) return { error: "City is required" };
  if (!gender) return { error: "Gender is required" };

  // Build notes with metadata
  const metadata: Record<string, unknown> = {};
  if (city) metadata.city = city;
  if (gender) metadata.gender = gender;
  if (categories.length > 0) metadata.categories = categories;
  if (languages.length > 0) metadata.languages = languages;
  if (tags.length > 0) metadata.tags = tags;

  let notes = notesText;
  if (Object.keys(metadata).length > 0) {
    notes = notes ? `${notes}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
  }

  const adminClient = createAdminClient();

  // Check uniqueness
  const { data: existingInvite } = await adminClient.from("influencer_invitations").select("id").ilike("instagram_username", instagramUsername).limit(1);
  if (existingInvite && existingInvite.length > 0) return { error: `An invitation for @${instagramUsername} already exists` };

  const { data: existingProfile } = await adminClient.from("influencer_profiles").select("influencer_id").ilike("instagram_handle", instagramUsername).limit(1);
  if (existingProfile && existingProfile.length > 0) return { error: `An influencer with @${instagramUsername} is already registered` };

  const { error } = await adminClient.from("influencer_invitations").insert({
    full_name: fullName,
    instagram_username: instagramUsername,
    profile_photo_url: profilePhotoUrl,
    notes,
    created_by: user.id,
    status: "pending",
  });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/influencers");
  return { success: true };
}

export async function deleteInfluencerInvitation(invitationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("influencer_invitations").delete().eq("id", invitationId).eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/dashboard/influencers");
  return { success: true };
}

export async function updateInfluencerInvitation(invitationId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const fullName = formData.get("full_name") as string;
  const instagramUsername = (formData.get("instagram_username") as string)?.replace(/^@/, "").trim();
  const notesText = (formData.get("notes") as string) || "";
  const city = (formData.get("city") as string) || "";
  const gender = (formData.get("gender") as string) || "";
  const categoriesCsv = (formData.get("categories_csv") as string || "").split(",").map(c => c.trim()).filter(Boolean);
  const languagesCsv = (formData.get("languages_csv") as string || "").split(",").map(l => l.trim()).filter(Boolean);
  const tagsCsv = (formData.get("tags_csv") as string || "").split(",").map(t => t.trim()).filter(Boolean);

  if (!fullName) return { error: "Name is required" };
  if (!instagramUsername) return { error: "Instagram username is required" };

  const metadata: Record<string, unknown> = {};
  if (city) metadata.city = city;
  if (gender) metadata.gender = gender;
  if (categoriesCsv.length > 0) metadata.categories = categoriesCsv;
  if (languagesCsv.length > 0) metadata.languages = languagesCsv;
  if (tagsCsv.length > 0) metadata.tags = tagsCsv;

  let notes = notesText;
  if (Object.keys(metadata).length > 0) {
    notes = notes ? `${notes}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("influencer_invitations").update({
    full_name: fullName,
    instagram_username: instagramUsername,
    notes,
  }).eq("id", invitationId).eq("status", "pending");

  if (error) return { error: error.message };
  revalidatePath("/dashboard/influencers");
  return { success: true };
}
