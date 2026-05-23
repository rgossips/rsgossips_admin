"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Uploads a video file to the campaign-images bucket under a creator-stories/
// prefix and returns the public URL. Mirrors the service image upload helper.
export async function uploadStoryVideo(formData: FormData): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided" };
  if (!file.type.startsWith("video/")) return { error: "Only video files are allowed" };
  // Stories are short reels, keep them tight to stop bloated uploads.
  if (file.size > 50 * 1024 * 1024) return { error: "Video must be under 50 MB" };

  const admin = createAdminClient();
  const ts = Date.now();
  const ext = file.name.split(".").pop() || "mp4";
  const path = `creator-stories/${ts}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const ab = await file.arrayBuffer();
  const { error } = await admin.storage
    .from("campaign-images")
    .upload(path, Buffer.from(ab), { contentType: file.type, upsert: true });
  if (error) return { error: error.message };

  const { data } = admin.storage.from("campaign-images").getPublicUrl(path);
  return { url: data.publicUrl };
}

function readForm(formData: FormData) {
  const influencer_id = ((formData.get("influencer_id") as string) || "").trim() || null;
  const username = ((formData.get("username") as string) || "").trim().replace(/^@/, "");
  const avatar_url = ((formData.get("avatar_url") as string) || "").trim();
  const video_url = ((formData.get("video_url") as string) || "").trim();
  const poster_url = ((formData.get("poster_url") as string) || "").trim();
  const position = parseInt((formData.get("position") as string) || "0", 10) || 0;
  const is_active = formData.get("is_active") === "on" || formData.get("is_active") === "true";

  return { influencer_id, username, avatar_url, video_url, poster_url, position, is_active };
}

export async function createCreatorStory(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const row = readForm(formData);
  if (!row.username) return { error: "Username is required" };
  if (!row.video_url) return { error: "Video URL is required (upload or paste a CDN link)" };

  const admin = createAdminClient();
  const { error } = await admin.from("creator_stories").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  redirect("/dashboard/creator-stories");
}

export async function updateCreatorStory(id: string, formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const row = readForm(formData);
  if (!row.username) return { error: "Username is required" };

  const admin = createAdminClient();
  const { error } = await admin.from("creator_stories").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  revalidatePath(`/dashboard/creator-stories/${id}/edit`);
  redirect("/dashboard/creator-stories");
}

export async function toggleCreatorStoryActive(id: string, nextValue: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("creator_stories")
    .update({ is_active: nextValue })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  return { ok: true };
}

export async function deleteCreatorStory(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin.from("creator_stories").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  return { ok: true };
}

export async function moveCreatorStory(id: string, direction: "up" | "down") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("creator_stories")
    .select("position")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Row not found" };

  const newPos = direction === "up" ? row.position - 1 : row.position + 1;
  const { error } = await admin
    .from("creator_stories")
    .update({ position: newPos })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  return { ok: true };
}

// Lighter version of the featured-creators picker — same data, no rating.
export async function searchInfluencersForStory(query: string) {
  const admin = createAdminClient();
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const { data } = await admin
    .from("influencer_profiles")
    .select(
      "influencer_id, full_name, username, instagram_handle, profile_photo_url, custom_profile_photo_url, followers_count"
    )
    .or(`instagram_handle.ilike.${like},username.ilike.${like},full_name.ilike.${like}`)
    .eq("status", "active")
    .limit(20);
  return data || [];
}
