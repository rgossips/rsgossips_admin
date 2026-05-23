"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Stays in lockstep with public.featured_creators (see migration 017).
function readForm(formData: FormData) {
  const influencer_id = ((formData.get("influencer_id") as string) || "").trim() || null;
  const username = ((formData.get("username") as string) || "").trim().replace(/^@/, "");
  const display_name = ((formData.get("display_name") as string) || "").trim();
  const avatar_url = ((formData.get("avatar_url") as string) || "").trim();
  const followers_label = ((formData.get("followers_label") as string) || "").trim();
  const ratingRaw = (formData.get("rating") as string) || "";
  const rating = ratingRaw ? Math.min(5, Math.max(0, Number(ratingRaw))) : null;
  const verified = formData.get("verified") === "on" || formData.get("verified") === "true";
  const instagram_url_raw = ((formData.get("instagram_url") as string) || "").trim();
  // Auto-fill the IG URL from the handle if the admin left it blank — saves
  // them typing the boilerplate every time.
  const instagram_url = instagram_url_raw || (username ? `https://www.instagram.com/${username}/` : "");
  const position = parseInt((formData.get("position") as string) || "0", 10) || 0;
  const is_active = formData.get("is_active") === "on" || formData.get("is_active") === "true";

  return {
    influencer_id,
    username,
    display_name,
    avatar_url,
    followers_label,
    rating,
    verified,
    instagram_url,
    position,
    is_active,
  };
}

export async function createFeaturedCreator(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const row = readForm(formData);
  if (!row.username) return { error: "Username is required" };
  if (!row.instagram_url) return { error: "Instagram URL is required" };

  const admin = createAdminClient();
  const { error } = await admin.from("featured_creators").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-creators");
  redirect("/dashboard/featured-creators");
}

export async function updateFeaturedCreator(id: string, formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const row = readForm(formData);
  if (!row.username) return { error: "Username is required" };

  const admin = createAdminClient();
  const { error } = await admin.from("featured_creators").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-creators");
  revalidatePath(`/dashboard/featured-creators/${id}/edit`);
  redirect("/dashboard/featured-creators");
}

export async function toggleFeaturedCreatorActive(id: string, nextValue: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("featured_creators")
    .update({ is_active: nextValue })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-creators");
  return { ok: true };
}

export async function deleteFeaturedCreator(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin.from("featured_creators").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-creators");
  return { ok: true };
}

// Bumps the row's position by ±1 within the active list. We don't need a
// global rebalance because position is a plain integer and the brand-side
// query sorts ascending — small gaps are fine.
export async function moveFeaturedCreator(id: string, direction: "up" | "down") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("featured_creators")
    .select("position")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Row not found" };

  const newPos = direction === "up" ? row.position - 1 : row.position + 1;
  const { error } = await admin
    .from("featured_creators")
    .update({ position: newPos })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-creators");
  return { ok: true };
}

// Looks up influencers for the "pick existing" picker on the form. Returns
// the data the form needs to prefill display fields. Limited to 20 hits.
export async function searchInfluencersForFeature(query: string) {
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
