"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminGate } from "@/lib/require-super-admin";

// homepage_settings key backing the editable section title above the
// Top Creator Stories carousel on the marketing home (migration 030).
const SECTION_TITLE_KEY = "creator_stories_section_title";

export async function getCreatorStoriesSectionTitle(): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("homepage_settings")
    .select("value")
    .eq("key", SECTION_TITLE_KEY)
    .maybeSingle();
  return data?.value || "TOP CREATOR STORIES";
}

export async function setCreatorStoriesSectionTitle(value: string): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const trimmed = (value || "").trim();
  if (!trimmed) return { error: "Title cannot be empty" };
  if (trimmed.length > 80) return { error: "Title must be 80 characters or fewer" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("homepage_settings")
    .upsert({ key: SECTION_TITLE_KEY, value: trimmed, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  return { ok: true };
}

// Uploads a video file to the campaign-images bucket under a creator-stories/
// prefix and returns the public URL. Mirrors the service image upload helper.
export async function uploadStoryVideo(formData: FormData): Promise<{ url?: string; error?: string }> {
  const gate = await adminGate();
  if (gate) return gate;

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
  const gate = await adminGate();
  if (gate) return gate;

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
  const gate = await adminGate();
  if (gate) return gate;

  const row = readForm(formData);
  if (!row.username) return { error: "Username is required" };

  const admin = createAdminClient();
  const { error } = await admin.from("creator_stories").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  revalidatePath(`/dashboard/creator-stories/${id}/edit`);
  redirect("/dashboard/creator-stories");
}

export async function toggleCreatorStoryActive(id: string, nextValue: boolean): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { error } = await admin
    .from("creator_stories")
    .update({ is_active: nextValue })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  return { ok: true };
}

export async function deleteCreatorStory(id: string): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { error } = await admin.from("creator_stories").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/creator-stories");
  return { ok: true };
}

export async function moveCreatorStory(id: string, direction: "up" | "down"): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

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

// Lighter version of the featured-creators picker — searches both
// registered influencers AND pending invitations so admin can pick
// pre-onboarded creators too.
export async function searchInfluencersForStory(query: string) {
  const admin = createAdminClient();
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const [registeredRes, invitedRes] = await Promise.all([
    admin
      .from("influencer_profiles")
      .select(
        "influencer_id, full_name, username, instagram_handle, profile_photo_url, custom_profile_photo_url, followers_count"
      )
      .or(`instagram_handle.ilike.${like},username.ilike.${like},full_name.ilike.${like}`)
      .limit(15),
    admin
      .from("influencer_invitations")
      .select("id, full_name, instagram_username, profile_photo_url, notes")
      .eq("status", "pending")
      .or(`instagram_username.ilike.${like},full_name.ilike.${like}`)
      .limit(15),
  ]);

  const parseFollowers = (s: string | undefined | null): number => {
    if (!s) return 0;
    const m = String(s).match(/([\d.]+)\s*([kKmM]?)/);
    if (!m) return 0;
    const num = parseFloat(m[1]);
    const unit = (m[2] || "").toLowerCase();
    if (unit === "m") return Math.round(num * 1_000_000);
    if (unit === "k") return Math.round(num * 1_000);
    return Math.round(num);
  };

  const registered = (registeredRes.data || []).map((r) => ({
    influencer_id: r.influencer_id as string | null,
    full_name: r.full_name,
    username: r.username,
    instagram_handle: r.instagram_handle,
    profile_photo_url: r.profile_photo_url,
    custom_profile_photo_url: r.custom_profile_photo_url,
    followers_count: r.followers_count,
    source: "registered" as const,
  }));

  const invited = (invitedRes.data || []).map((r) => {
    let followers = 0;
    if (r.notes) {
      try {
        const sep = r.notes.indexOf("\n---\n");
        const jsonStr = sep > -1 ? r.notes.slice(sep + 5) : (r.notes.startsWith("{") ? r.notes : "");
        if (jsonStr) {
          const meta = JSON.parse(jsonStr);
          if (meta.followers) followers = parseFollowers(meta.followers);
        }
      } catch { /* ignore */ }
    }
    return {
      influencer_id: null as string | null,
      full_name: r.full_name,
      username: r.instagram_username,
      instagram_handle: r.instagram_username,
      profile_photo_url: r.profile_photo_url,
      custom_profile_photo_url: null,
      followers_count: followers,
      source: "invited" as const,
    };
  });

  const seen = new Set<string>();
  const combined: Array<(typeof registered)[number] | (typeof invited)[number]> = [];
  for (const r of [...registered, ...invited]) {
    const handle = (r.instagram_handle || "").toLowerCase();
    if (handle && seen.has(handle)) continue;
    if (handle) seen.add(handle);
    combined.push(r);
  }
  return combined.slice(0, 20);
}
