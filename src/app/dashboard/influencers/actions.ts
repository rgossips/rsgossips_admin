"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireAdmin, adminGate } from "@/lib/require-super-admin";
import { sendMail } from "@/lib/mailer";
import { renderUserStatusEmail } from "@/lib/email-templates";
import { normalizeGender, fetchExistingHandles } from "@/lib/bulk-invite-utils";
import { enforceRateLimit, auditLog } from "@/lib/rate-limit";
import { logError, friendlyDbError } from "@/lib/log";
import { isHttpUrl, isInstagramHandle, clampLen } from "@/lib/validation";
import {
  VALID_PLAN_KEYS,
  VALID_BILLING_CYCLES,
  PLAN_RANK,
  PLAN_LABEL,
  TEMPLATE_MIN_PLAN,
} from "@/lib/subscription-plans";

// Admin-only override of an influencer's subscription plan. Bypasses the
// payment gateway entirely — useful for comping accounts, granting a tier,
// or fixing data after a refund.
//
// Writes THREE columns, because the consumer app needs all three to treat
// the override as a real plan:
//   subscription_plan — the tier getEffectivePlan() reads (starter/pro/elite
//                       only; "trial" is NOT an entitlement over there, it
//                       falls back to an account-age check, so comping
//                       "trial" to an account older than 30 days granted
//                       nothing — that's why overrides looked ignored).
//   billing_cycle     — drives the renewal countdown; a tier without a cycle
//                       shows someone on an annual comp a 30-day countdown.
//   payment_gateway   — set to "admin" so a later stray gateway webhook
//                       (subscription.cancelled on an old Razorpay sub) skips
//                       its downgrade: the webhook bails when the gateway on
//                       the row isn't its own. A real purchase overwrites
//                       this back to the paying rail, so it's self-healing.
//
// Mirrors the webhooks' setUserPlan reset behaviour: if the user's saved
// media-kit template is above the new tier (e.g. Neo-Brutalist on an
// Elite→Pro downgrade) we flip media_kit_template back to "classic" in the
// same write, so their picker is never stuck in an unsave-able state.
export async function updateInfluencerPlan(
  influencerId: string,
  plan: string,
  cycle: string,
): Promise<{ error?: string; success?: boolean }> {
  // Money-relevant (comps a paid tier for free) — capture the actor for audit.
  let actorId: string;
  try { actorId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  if (!VALID_PLAN_KEYS.has(plan)) return { error: "Invalid plan" };
  if (!VALID_BILLING_CYCLES.has(cycle)) return { error: "Invalid billing cycle" };
  await auditLog("update_plan", actorId, `${influencerId}:${plan}:${cycle}`);

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
    billing_cycle: cycle,
    payment_gateway: "admin",
    updated_at: new Date().toISOString(),
  };
  if (templateNoLongerAllowed) update.media_kit_template = "classic";

  const { error } = await adminClient
    .from("influencer_profiles")
    .update(update)
    .eq("influencer_id", influencerId);

  if (error) {
    return { error: friendlyDbError("update-plan", error, "Could not update the plan. Please try again.", { influencerId, plan, cycle }) };
  }

  if (templateNoLongerAllowed) {
    // Best-effort heads-up so the creator knows their kit reverted; failures
    // are non-fatal because the plan change itself already succeeded.
    try {
      await adminClient.from("notifications").insert({
        user_id: influencerId,
        type: "media_kit_template_reset",
        title: "Media kit reset to Classic",
        body: JSON.stringify({
          text: `Your ${PLAN_LABEL[plan] || plan} plan doesn't include your previous media-kit template, so your kit was switched back to Classic. Pick another any time from your media-kit page.`,
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

export async function toggleInfluencerStatus(influencerId: string, _currentStatus?: string): Promise<{ error?: string; success?: boolean; newStatus?: string; emailSent?: boolean; emailError?: string }> {
  let actorId: string;
  try { actorId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const adminClient = createAdminClient();

  // Read the CURRENT status from the DB rather than trusting the client's
  // `currentStatus` — a stale value could otherwise flip the account the
  // wrong way and fire a wrong-direction email.
  const { data: profile, error: readErr } = await adminClient
    .from("influencer_profiles")
    .select("full_name, username, email, status")
    .eq("influencer_id", influencerId)
    .maybeSingle();
  if (readErr) { logError("toggle-status.read", readErr, { influencerId }); return { error: "Could not load the influencer. Please try again." }; }
  if (!profile) return { error: "Influencer not found." };

  const newStatus = profile.status === "active" ? "suspended" : "active";
  const { error } = await adminClient.from("influencer_profiles").update({ status: newStatus }).eq("influencer_id", influencerId);
  if (error) { logError("toggle-status.update", error, { influencerId, newStatus }); return { error: "Could not update the status. Please try again." }; }

  // Notify the creator. Non-fatal — the status change already succeeded.
  // Rate-limited per (admin, creator) so a rapid suspend↔reactivate loop
  // can't flood the creator's mailbox / burn SMTP quota.
  let emailSent = false;
  let emailError: string | undefined;
  if (profile.email) {
    const rl = await enforceRateLimit({
      action: "status_email",
      actorId,
      limit: 3,
      windowSec: 60 * 60,
      target: influencerId,
    });
    if (rl.allowed) {
      try {
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
      } catch (e) {
        emailError = e instanceof Error ? e.message : "Failed to send notification email";
        logError("toggle-status.email", e, { influencerId, newStatus });
      }
    }
  }

  revalidatePath("/dashboard/influencers");
  return { success: true, newStatus, emailSent, emailError };
}

export async function updateInfluencer(influencerId: string, formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const updates: Record<string, unknown> = {};
  const fields = ["full_name", "username", "instagram_handle", "email", "bio", "city_id", "location", "status", "verification_status", "tier", "gender", "date_of_birth", "profile_photo_url", "creator_type"];
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
  // Explicit cap BEFORE buffering into memory — the bucket's
  // fileSizeLimit only rejects at storage time, after the whole payload
  // has already streamed through the server action.
  if (file.size > 5 * 1024 * 1024) return { error: "Image too large — maximum size is 5MB." };

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

  const fullName = clampLen(formData.get("full_name") as string, 120);
  const instagramUsername = (formData.get("instagram_username") as string)?.replace(/^@/, "").trim() || "";
  const profilePhotoUrl = (formData.get("profile_photo_url") as string) || "";
  const notesText = clampLen(formData.get("notes") as string, 2000);
  const city = clampLen(formData.get("city") as string, 300);
  const gender = (formData.get("gender") as string) || "";
  const categories = formData.getAll("categories") as string[];
  const languages = formData.getAll("languages") as string[];
  const tags = formData.getAll("tags") as string[];
  // Profile Type — optional; stored in the invitation notes metadata so it
  // rides across to the influencer_profiles row on claim. The RS_Gossips
  // create-profile edge function reads notes.creator_type (+ categories,
  // gender, city) and copies them onto the profile columns — keep the key
  // names aligned with that function or the classification silently drops.
  const rawCreatorType = (formData.get("creator_type") as string) || "";
  const creatorType = rawCreatorType === "meme_page" || rawCreatorType === "celebrity" ? rawCreatorType : "";

  if (!fullName) return { error: "Name is required" };
  if (!instagramUsername) return { error: "Instagram username is required" };
  if (!isInstagramHandle(instagramUsername)) return { error: "Enter a valid Instagram username (letters, numbers, . and _, max 30)." };
  if (!city) return { error: "City is required" };
  if (!gender) return { error: "Gender is required" };
  if (profilePhotoUrl && !isHttpUrl(profilePhotoUrl)) return { error: "Profile photo URL must start with http:// or https://." };

  // Build notes with metadata
  const metadata: Record<string, unknown> = {};
  if (city) metadata.city = city;
  if (gender) metadata.gender = gender;
  if (categories.length > 0) metadata.categories = categories;
  if (languages.length > 0) metadata.languages = languages;
  if (tags.length > 0) metadata.tags = tags;
  if (creatorType) metadata.creator_type = creatorType;

  let notes = notesText;
  if (Object.keys(metadata).length > 0) {
    notes = notes ? `${notes}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
  }

  const adminClient = createAdminClient();

  // Check uniqueness. A FAILED lookup must not be read as "no duplicate" —
  // that would let a duplicate through. Surface the error and let the admin
  // retry.
  const { data: existingInvite, error: invLookupErr } = await adminClient.from("influencer_invitations").select("id").ilike("instagram_username", instagramUsername).limit(1);
  if (invLookupErr) { logError("invite-influencer.dupcheck", invLookupErr, { instagramUsername }); return { error: "Could not verify uniqueness right now. Please retry." }; }
  if (existingInvite && existingInvite.length > 0) return { error: `An invitation for @${instagramUsername} already exists` };

  const { data: existingProfile, error: profLookupErr } = await adminClient.from("influencer_profiles").select("influencer_id").ilike("instagram_handle", instagramUsername).limit(1);
  if (profLookupErr) { logError("invite-influencer.dupcheck2", profLookupErr, { instagramUsername }); return { error: "Could not verify uniqueness right now. Please retry." }; }
  if (existingProfile && existingProfile.length > 0) return { error: `An influencer with @${instagramUsername} is already registered` };

  const { error } = await adminClient.from("influencer_invitations").insert({
    full_name: fullName,
    instagram_username: instagramUsername,
    profile_photo_url: profilePhotoUrl,
    notes,
    created_by: actingUserId,
    status: "pending",
  });

  if (error) { logError("invite-influencer.insert", error, { instagramUsername }); return { error: "Could not create the invitation. Please try again." }; }
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
  // Same allowlist as inviteInfluencer — empty string clears the classification.
  const rawCreatorType = (formData.get("creator_type") as string) || "";
  const creatorType = rawCreatorType === "meme_page" || rawCreatorType === "celebrity" ? rawCreatorType : "";

  if (!fullName) return { error: "Name is required" };
  if (!instagramUsername) return { error: "Instagram username is required" };

  const adminClient = createAdminClient();

  // Read-merge-write the notes trailer. The edit form only knows about a
  // fixed set of keys (city, gender, categories, languages, tags,
  // creator_type); other keys — e.g. `followers`/`bio` written by the
  // RS_Gossips enrichment script and read by the featured-creators /
  // creator-stories pickers — must survive an edit. So we start from the
  // existing metadata and only mutate the keys this form owns.
  const { data: existing } = await adminClient
    .from("influencer_invitations")
    .select("notes")
    .eq("id", invitationId)
    .maybeSingle();

  let metadata: Record<string, unknown> = {};
  if (existing?.notes) {
    const sep = existing.notes.indexOf("\n---\n");
    const jsonStr = sep !== -1 ? existing.notes.slice(sep + 5) : (existing.notes.startsWith("{") ? existing.notes : "");
    if (jsonStr) { try { metadata = JSON.parse(jsonStr) || {}; } catch { metadata = {}; } }
  }

  // Form-owned keys: set when present, delete when cleared — so the admin
  // can remove a value, but keys the form doesn't manage are untouched.
  const setOrDelete = (key: string, value: unknown, keep: boolean) => {
    if (keep) metadata[key] = value;
    else delete metadata[key];
  };
  setOrDelete("city", city, !!city);
  setOrDelete("gender", gender, !!gender);
  setOrDelete("categories", categoriesCsv, categoriesCsv.length > 0);
  setOrDelete("languages", languagesCsv, languagesCsv.length > 0);
  setOrDelete("tags", tagsCsv, tagsCsv.length > 0);
  setOrDelete("creator_type", creatorType, !!creatorType);

  let notes = notesText;
  if (Object.keys(metadata).length > 0) {
    notes = notes ? `${notes}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
  }

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

// Processes one chunk of bulk-invite rows. The client sends the file in
// chunks (see bulk-invite.tsx) so no single invocation risks the serverless
// timeout; `startRow` is the spreadsheet row number of rows[0] so failure
// messages point at the right line. Existence is checked in bulk (a few
// batched queries instead of 2 per row) and survivors are inserted in one
// batch — a duplicate/invalid row never halts the run, it's collected into
// `failed` and reported at the end.
export async function bulkInviteInfluencers(rows: BulkInfluencerRow[], startRow = 2) {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden", success: 0, failed: [] };
  }

  // Hard server-side cap — the client chunks at 200, so a payload bigger
  // than this bypassed the UI. Rejects unbounded arrays (memory/DoS).
  if (!Array.isArray(rows)) return { error: "Invalid payload.", success: 0, failed: [] };
  if (rows.length > 500) {
    return { error: "Too many rows in one request (max 500). Use the bulk uploader, which batches automatically.", success: 0, failed: [] };
  }
  // Per-admin throughput cap across chunks (60 calls/hour ≈ up to 12k rows).
  const rl = await enforceRateLimit({ action: "bulk_invite", actorId: actingUserId, limit: 60, windowSec: 60 * 60 });
  if (!rl.allowed) {
    return { error: "Bulk import rate limit reached. Please wait a bit and retry the remaining rows.", success: 0, failed: [] };
  }

  const adminClient = createAdminClient();
  const results: { success: number; failed: Array<{ row: number; reason: string; data: BulkInfluencerRow }> } = { success: 0, failed: [] };
  const splitField = (val?: string) => (val || "").toString().split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  // Pass 1 — validate + normalize in memory. Collect the rows that are
  // structurally valid along with the row they'll insert; everything else
  // goes straight to `failed`.
  type Prepared = { rowNum: number; igLower: string; data: BulkInfluencerRow; insert: Record<string, unknown> };
  const prepared: Prepared[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = startRow + i;
    const fullName = (row.full_name || "").toString().trim();
    const ig = (row.instagram_username || "").toString().replace(/^@/, "").trim();
    // City may hold multiple values separated by ',' or ';' (same
    // convention as categories/languages). Normalize to the canonical
    // comma-joined string the edit modals parse.
    const city = splitField(row.city).join(", ");
    // Gender is lenient: any spelling of male/female/non-binary maps to the
    // canonical value; anything else (incl. blank) → prefer_not_to_say.
    const gender = normalizeGender(row.gender);

    if (!fullName) { results.failed.push({ row: rowNum, reason: "Name is required", data: row }); continue; }
    if (!ig) { results.failed.push({ row: rowNum, reason: "Instagram username is required", data: row }); continue; }
    if (!city) { results.failed.push({ row: rowNum, reason: "City is required", data: row }); continue; }

    const igLower = ig.toLowerCase();
    if (seenInFile.has(igLower)) {
      results.failed.push({ row: rowNum, reason: `Duplicate of @${ig} earlier in the file`, data: row });
      continue;
    }
    seenInFile.add(igLower);

    const metadata: Record<string, unknown> = { city, gender };
    const cats = splitField(row.categories);
    if (cats.length > 0) metadata.categories = cats;
    const langs = splitField(row.languages);
    if (langs.length > 0) metadata.languages = langs;
    const tagList = splitField(row.tags);
    if (tagList.length > 0) metadata.tags = tagList;

    const notesText = (row.notes || "").toString().trim();
    const notes = notesText ? `${notesText}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);

    prepared.push({
      rowNum,
      igLower,
      data: row,
      insert: {
        full_name: fullName,
        instagram_username: ig,
        profile_photo_url: "",
        notes,
        created_by: actingUserId,
        status: "pending",
      },
    });
  }

  // Pass 2 — one bulk existence check across both tables (instead of 2
  // queries per row), then drop rows that already exist as an invitation
  // or a registered profile.
  const igs = prepared.map((p) => p.igLower);
  const [existingInvites, existingProfiles] = await Promise.all([
    fetchExistingHandles(adminClient, "influencer_invitations", "instagram_username", igs),
    fetchExistingHandles(adminClient, "influencer_profiles", "instagram_handle", igs),
  ]);

  const toInsert: Prepared[] = [];
  for (const p of prepared) {
    if (existingInvites.has(p.igLower)) {
      results.failed.push({ row: p.rowNum, reason: `Invitation for @${p.insert.instagram_username} already exists`, data: p.data });
    } else if (existingProfiles.has(p.igLower)) {
      results.failed.push({ row: p.rowNum, reason: `Influencer @${p.insert.instagram_username} already registered`, data: p.data });
    } else {
      toInsert.push(p);
    }
  }

  // Pass 3 — batch insert survivors. On a batch-level error fall back to
  // per-row inserts so one bad row doesn't sink the whole chunk.
  if (toInsert.length > 0) {
    const { error } = await adminClient.from("influencer_invitations").insert(toInsert.map((p) => p.insert));
    if (error) {
      for (const p of toInsert) {
        const { error: rowErr } = await adminClient.from("influencer_invitations").insert(p.insert);
        if (rowErr) results.failed.push({ row: p.rowNum, reason: rowErr.message, data: p.data });
        else results.success++;
      }
    } else {
      results.success += toInsert.length;
    }
  }

  revalidatePath("/dashboard/influencers");
  return results;
}

