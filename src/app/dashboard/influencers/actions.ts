"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireAdmin, adminGate } from "@/lib/require-super-admin";
import { sendMail } from "@/lib/mailer";
import { renderUserStatusEmail } from "@/lib/email-templates";

// Admin-only override of an influencer's subscription plan. Bypasses
// Stripe entirely — useful for comping accounts, granting trials, or
// fixing data after a refund. Mirrors the Stripe-webhook reset behaviour:
// if the user's saved media-kit template is above the new plan's tier
// (e.g. they're on Glass Blue and admin moves them to Starter) we flip
// media_kit_template back to "classic" in the same write, so the picker
// is never stuck in an unsave-able state.
const VALID_PLANS = new Set(["trial", "starter", "pro", "elite"]);
const TEMPLATE_MIN_PLAN: Record<string, string> = {
  classic: "starter",
  glass_blue: "pro",
  editorial_noir: "pro",
  bento_sunset: "pro",
  neo_brutalist: "pro",
};
const PLAN_RANK: Record<string, number> = { trial: 2, starter: 1, pro: 2, elite: 3 };

export async function updateInfluencerPlan(influencerId: string, plan: string): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  if (!VALID_PLANS.has(plan)) return { error: "Invalid plan" };

  const adminClient = createAdminClient();

  const { data: prior } = await adminClient
    .from("influencer_profiles")
    .select("media_kit_template")
    .eq("influencer_id", influencerId)
    .maybeSingle();
  const previousTemplate = prior?.media_kit_template || "classic";
  const requiredRank = PLAN_RANK[TEMPLATE_MIN_PLAN[previousTemplate] || "starter"] || 0;
  const nextPlanRank = PLAN_RANK[plan] || 0;
  const templateNoLongerAllowed = requiredRank > nextPlanRank;

  const update: Record<string, unknown> = {
    subscription_plan: plan,
    updated_at: new Date().toISOString(),
  };
  if (templateNoLongerAllowed) update.media_kit_template = "classic";

  const { error } = await adminClient
    .from("influencer_profiles")
    .update(update)
    .eq("influencer_id", influencerId);

  if (error) return { error: error.message };

  if (templateNoLongerAllowed) {
    // Best-effort heads-up so the creator knows their kit reverted; failures
    // are non-fatal because the plan change itself already succeeded.
    try {
      await adminClient.from("notifications").insert({
        user_id: influencerId,
        type: "media_kit_template_reset",
        title: "Media kit reset to Classic",
        body: JSON.stringify({
          text: `Your ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan only includes the Classic media-kit template, so your kit was switched back. Pick another any time from your media-kit page.`,
          link: "/influencer/media-kit",
        }),
        is_read: false,
      });
    } catch {}
  }

  revalidatePath(`/dashboard/influencers/${influencerId}`);
  revalidatePath("/dashboard/influencers");
  return { success: true };
}

export async function toggleInfluencerStatus(influencerId: string, currentStatus: string): Promise<{ error?: string; success?: boolean; newStatus?: string; emailSent?: boolean; emailError?: string }> {
  const gate = await adminGate();
  if (gate) return gate;

  const newStatus = currentStatus === "active" ? "suspended" : "active";
  const adminClient = createAdminClient();
  const { error } = await adminClient.from("influencer_profiles").update({ status: newStatus }).eq("influencer_id", influencerId);
  if (error) return { error: error.message };

  // Notify the creator. Non-fatal — the status change itself already
  // succeeded, so a mail failure shouldn't roll it back.
  let emailSent = false;
  let emailError: string | undefined;
  try {
    const { data: profile } = await adminClient
      .from("influencer_profiles")
      .select("full_name, username, email")
      .eq("influencer_id", influencerId)
      .maybeSingle();
    if (profile?.email) {
      const { html, text, subjectFragment } = renderUserStatusEmail({
        fullName: profile.full_name || profile.username || "there",
        action: newStatus === "suspended" ? "suspended" : "reactivated",
      });
      await sendMail({
        to: profile.email,
        subject: `Your RecentGossips account has been ${subjectFragment}`,
        html,
        text,
      });
      emailSent = true;
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : "Failed to send notification email";
  }

  revalidatePath("/dashboard/influencers");
  return { success: true, newStatus, emailSent, emailError };
}

export async function updateInfluencer(influencerId: string, formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const updates: Record<string, unknown> = {};
  const fields = ["full_name", "username", "instagram_handle", "email", "bio", "city_id", "location", "status", "verification_status", "tier", "gender", "date_of_birth", "profile_photo_url"];
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

export async function uploadInfluencerPhoto(formData: FormData): Promise<{ error?: string; url?: string }> {
  const gate = await adminGate();
  if (gate) return gate;

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

export async function inviteInfluencer(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

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
    created_by: actingUserId,
    status: "pending",
  });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/influencers");
  return { success: true };
}

export async function deleteInfluencerInvitation(invitationId: string): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("influencer_invitations").delete().eq("id", invitationId).eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/dashboard/influencers");
  return { success: true };
}

export async function updateInfluencerInvitation(invitationId: string, formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

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

interface BulkInfluencerRow {
  full_name: string;
  instagram_username: string;
  city?: string;
  gender?: string;
  categories?: string;
  languages?: string;
  tags?: string;
  notes?: string;
}

export async function bulkInviteInfluencers(rows: BulkInfluencerRow[]) {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden", success: 0, failed: [] };
  }

  const adminClient = createAdminClient();
  const results: { success: number; failed: Array<{ row: number; reason: string; data: BulkInfluencerRow }> } = { success: 0, failed: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const fullName = (row.full_name || "").toString().trim();
    const ig = (row.instagram_username || "").toString().replace(/^@/, "").trim();
    const city = (row.city || "").toString().trim();
    const gender = (row.gender || "").toString().trim().toLowerCase();

    if (!fullName) { results.failed.push({ row: rowNum, reason: "Name is required", data: row }); continue; }
    if (!ig) { results.failed.push({ row: rowNum, reason: "Instagram username is required", data: row }); continue; }
    if (!city) { results.failed.push({ row: rowNum, reason: "City is required", data: row }); continue; }
    if (!gender) { results.failed.push({ row: rowNum, reason: "Gender is required", data: row }); continue; }

    const { data: existingInvite } = await adminClient.from("influencer_invitations").select("id").ilike("instagram_username", ig).limit(1);
    if (existingInvite && existingInvite.length > 0) {
      results.failed.push({ row: rowNum, reason: `Invitation for @${ig} already exists`, data: row });
      continue;
    }
    const { data: existingProfile } = await adminClient.from("influencer_profiles").select("influencer_id").ilike("instagram_handle", ig).limit(1);
    if (existingProfile && existingProfile.length > 0) {
      results.failed.push({ row: rowNum, reason: `Influencer @${ig} already registered`, data: row });
      continue;
    }

    const splitField = (val?: string) => (val || "").toString().split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const metadata: Record<string, unknown> = { city, gender };
    const cats = splitField(row.categories);
    if (cats.length > 0) metadata.categories = cats;
    const langs = splitField(row.languages);
    if (langs.length > 0) metadata.languages = langs;
    const tagList = splitField(row.tags);
    if (tagList.length > 0) metadata.tags = tagList;

    const notesText = (row.notes || "").toString().trim();
    const notes = notesText ? `${notesText}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);

    const { error } = await adminClient.from("influencer_invitations").insert({
      full_name: fullName,
      instagram_username: ig,
      profile_photo_url: "",
      notes,
      created_by: actingUserId,
      status: "pending",
    });

    if (error) {
      results.failed.push({ row: rowNum, reason: error.message, data: row });
    } else {
      results.success++;
    }
  }

  revalidatePath("/dashboard/influencers");
  return results;
}

