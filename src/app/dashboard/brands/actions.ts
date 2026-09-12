"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireAdmin, adminGate } from "@/lib/require-super-admin";
import { fetchExistingHandles } from "@/lib/bulk-invite-utils";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { isEmail, isHttpUrl, isInstagramHandle, clampLen } from "@/lib/validation";
import { notifyUser } from "@/lib/notify";

// Verification is the gate on a brand doing anything: brand-campaigns refuses
// to publish for a brand whose verification_status isn't "verified" and tells
// them "your brand is still under review". So the verdict here is exactly the
// thing they're waiting on, and until now it was delivered silently — a
// verified brand had no idea it could start publishing.
//
// "pending" is deliberately silent: that's an admin moving a row back into the
// queue, not a decision addressed to the brand.
const VERIFICATION_NOTIFICATIONS: Record<string, { type: string; title: string; text: string }> = {
  verified: {
    type: "brand_verified",
    title: "Your brand is verified",
    text: "Verification is complete — you can now publish campaigns and start working with creators.",
  },
  rejected: {
    type: "brand_verification_rejected",
    title: "Verification needs another look",
    text: "We couldn't verify your brand with the details provided. Update your profile and we'll review it again.",
  },
};

export async function updateBrandVerification(brandId: string, action: "verified" | "rejected" | "pending"): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const adminClient = createAdminClient();

  // Read the prior state so re-picking the same verdict doesn't re-notify.
  const { data: prior } = await adminClient
    .from("brand_profiles")
    .select("verification_status")
    .eq("brand_id", brandId)
    .maybeSingle();

  const { error } = await adminClient
    .from("brand_profiles")
    .update({
      verification_status: action,
      is_verified: action === "verified",
    })
    .eq("brand_id", brandId);

  if (error) return { error: error.message };

  const notification = VERIFICATION_NOTIFICATIONS[action];
  if (notification && prior?.verification_status !== action) {
    await notifyUser(
      {
        userId: brandId,
        type: notification.type,
        title: notification.title,
        body: {
          text: notification.text,
          link: action === "verified" ? "/brands/campaigns" : "/brands/profile",
        },
      },
      "brand-verification",
    );
  }

  revalidatePath("/dashboard/brands");
  revalidatePath(`/dashboard/brands/${brandId}`);
  return { success: true };
}

export async function uploadBrandIcon(formData: FormData): Promise<{ error?: string; url?: string }> {
  const gate = await adminGate();
  if (gate) return gate;

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided" };
  if (!file.type.startsWith("image/")) return { error: "Only images are allowed" };
  if (file.size > 5 * 1024 * 1024) return { error: "File must be under 5MB" };

  const adminClient = createAdminClient();

  // Ensure bucket exists
  await adminClient.storage.createBucket("brand-icons", {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
  });

  const timestamp = Date.now();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `icons/${timestamp}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error } = await adminClient.storage
    .from("brand-icons")
    .upload(path, Buffer.from(arrayBuffer), {
      contentType: file.type,
      upsert: true,
    });

  if (error) return { error: error.message };

  const { data } = adminClient.storage.from("brand-icons").getPublicUrl(path);
  return { url: data.publicUrl };
}

export async function inviteBrand(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const brandName = clampLen(formData.get("brand_name") as string, 160);
  const instagramUsername = (formData.get("instagram_username") as string)?.replace(/^@/, "").trim() || "";
  const logoUrl = (formData.get("logo_url") as string) || "";
  const notesText = clampLen(formData.get("notes") as string, 2000);
  const category = (formData.get("category") as string) || "";
  const instagramVerified = (formData.get("instagram_verified") as string) === "yes";

  if (!brandName) return { error: "Brand name is required" };
  if (!instagramUsername) return { error: "Instagram username is required" };
  if (!isInstagramHandle(instagramUsername)) return { error: "Enter a valid Instagram username (letters, numbers, . and _, max 30)." };
  if (logoUrl && !isHttpUrl(logoUrl)) return { error: "Logo URL must start with http:// or https://." };

  // Build notes with metadata
  const metadata: Record<string, unknown> = {};
  if (category) metadata.category = category;
  metadata.instagram_verified = instagramVerified;

  let notes = notesText;
  if (Object.keys(metadata).length > 0) {
    notes = notes ? `${notes}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
  }

  const adminClient = createAdminClient();

  // Uniqueness — a failed lookup must not be treated as "no duplicate".
  const { data: existing, error: invErr } = await adminClient
    .from("brand_invitations")
    .select("id")
    .ilike("instagram_username", instagramUsername)
    .limit(1);
  if (invErr) { logError("invite-brand.dupcheck", invErr, { instagramUsername }); return { error: "Could not verify uniqueness right now. Please retry." }; }
  if (existing && existing.length > 0) {
    return { error: `An invitation for @${instagramUsername} already exists` };
  }

  const { data: existingProfile, error: profErr } = await adminClient
    .from("brand_profiles")
    .select("brand_id")
    .ilike("instagram_username", instagramUsername)
    .limit(1);
  if (profErr) { logError("invite-brand.dupcheck2", profErr, { instagramUsername }); return { error: "Could not verify uniqueness right now. Please retry." }; }
  if (existingProfile && existingProfile.length > 0) {
    return { error: `A brand with @${instagramUsername} is already registered` };
  }

  const { error } = await adminClient.from("brand_invitations").insert({
    brand_name: brandName,
    instagram_username: instagramUsername,
    logo_url: logoUrl,
    notes,
    created_by: actingUserId,
    status: "pending",
  });

  if (error) { logError("invite-brand.insert", error, { instagramUsername }); return { error: "Could not create the invitation. Please try again." }; }

  revalidatePath("/dashboard/brands");
  return { success: true };
}

export async function updateBrand(brandId: string, formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const updates: Record<string, unknown> = {};
  const fields = ["brand_name", "contact_name", "contact_role", "contact_email", "contact_phone", "instagram_username", "website_url", "short_description", "full_description", "gstin", "status", "verification_status", "listing_type", "tier", "monthly_budget_range", "preferred_influencer_tier", "logo_url"];
  // Checkbox: present ("on") when ticked, absent when not.
  updates.auto_approve_campaigns = formData.get("auto_approve_campaigns") === "on";
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null) updates[f] = (v as string) || null;
  }
  if (formData.get("verification_status") === "verified") updates.is_verified = true;
  else if (formData.has("verification_status")) updates.is_verified = false;
  updates.updated_at = new Date().toISOString();

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("brand_profiles").update(updates).eq("brand_id", brandId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/brands/${brandId}`);
  revalidatePath("/dashboard/brands");
  return { success: true };
}

// Keep the old addBrand for backward compat (direct brand_profiles insert)
export async function addBrand(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const brandName = clampLen(formData.get("brand_name") as string, 160);
  const contactName = clampLen(formData.get("contact_name") as string, 120);
  const contactPhone = clampLen(formData.get("contact_phone") as string, 20);
  const contactEmail = (formData.get("contact_email") as string || "").trim();
  const gstin = clampLen(formData.get("gstin") as string, 20);

  if (!brandName) return { error: "Brand name is required" };
  if (contactEmail && !isEmail(contactEmail)) return { error: "Enter a valid contact email address." };
  if (contactPhone && !/^[+\d][\d\s-]{5,19}$/.test(contactPhone)) return { error: "Enter a valid contact phone number." };

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("brand_profiles").insert({
    brand_name: brandName,
    contact_name: contactName || null,
    contact_phone: contactPhone || null,
    contact_email: contactEmail || null,
    gstin: gstin || null,
    verification_status: "pending",
    status: "active",
  });

  if (error) { logError("add-brand.insert", error, { brandName }); return { error: "Could not add the brand. Please try again." }; }

  revalidatePath("/dashboard/brands");
  return { success: true };
}

interface BulkBrandRow {
  brand_name: string;
  instagram_username: string;
  category?: string;
  instagram_verified?: string;
  notes?: string;
}

// One chunk of the bulk brand invite. Mirrors bulkInviteInfluencers:
// client-chunked with a `startRow` offset, bulk existence check, batch
// insert, and duplicates/invalid rows collected into `failed` (never
// halting the run) so the whole file always finishes.
export async function bulkInviteBrands(rows: BulkBrandRow[], startRow = 2) {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden", success: 0, failed: [] };
  }

  if (!Array.isArray(rows)) return { error: "Invalid payload.", success: 0, failed: [] };
  if (rows.length > 500) {
    return { error: "Too many rows in one request (max 500). Use the bulk uploader, which batches automatically.", success: 0, failed: [] };
  }
  const rl = await enforceRateLimit({ action: "bulk_invite", actorId: actingUserId, limit: 60, windowSec: 60 * 60 });
  if (!rl.allowed) {
    return { error: "Bulk import rate limit reached. Please wait a bit and retry the remaining rows.", success: 0, failed: [] };
  }

  const adminClient = createAdminClient();
  const results: { success: number; failed: Array<{ row: number; reason: string; data: BulkBrandRow }> } = { success: 0, failed: [] };

  type Prepared = { rowNum: number; igLower: string; data: BulkBrandRow; insert: Record<string, unknown> };
  const prepared: Prepared[] = [];
  const seenInFile = new Set<string>();

  // Pass 1 — validate + normalize in memory.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = startRow + i;
    const brandName = (row.brand_name || "").toString().trim();
    const ig = (row.instagram_username || "").toString().replace(/^@/, "").trim();

    if (!brandName) { results.failed.push({ row: rowNum, reason: "Brand name is required", data: row }); continue; }
    if (!ig) { results.failed.push({ row: rowNum, reason: "Instagram username is required", data: row }); continue; }

    const igLower = ig.toLowerCase();
    if (seenInFile.has(igLower)) {
      results.failed.push({ row: rowNum, reason: `Duplicate of @${ig} earlier in the file`, data: row });
      continue;
    }
    seenInFile.add(igLower);

    const category = (row.category || "").toString().trim();
    const igVerifiedStr = (row.instagram_verified || "").toString().trim().toLowerCase();
    const igVerified = igVerifiedStr === "yes" || igVerifiedStr === "true" || igVerifiedStr === "1";

    const metadata: Record<string, unknown> = {};
    if (category) metadata.category = category;
    metadata.instagram_verified = igVerified;

    const notesText = (row.notes || "").toString().trim();
    const notes = notesText ? `${notesText}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);

    prepared.push({
      rowNum,
      igLower,
      data: row,
      insert: {
        brand_name: brandName,
        instagram_username: ig,
        logo_url: "",
        notes,
        created_by: actingUserId,
        status: "pending",
      },
    });
  }

  // Pass 2 — bulk existence check across invitations + registered brands.
  const igs = prepared.map((p) => p.igLower);
  const [existingInvites, existingProfiles] = await Promise.all([
    fetchExistingHandles(adminClient, "brand_invitations", "instagram_username", igs),
    fetchExistingHandles(adminClient, "brand_profiles", "instagram_username", igs),
  ]);

  const toInsert: Prepared[] = [];
  for (const p of prepared) {
    if (existingInvites.has(p.igLower)) {
      results.failed.push({ row: p.rowNum, reason: `Invitation for @${p.insert.instagram_username} already exists`, data: p.data });
    } else if (existingProfiles.has(p.igLower)) {
      results.failed.push({ row: p.rowNum, reason: `Brand @${p.insert.instagram_username} already registered`, data: p.data });
    } else {
      toInsert.push(p);
    }
  }

  // Pass 3 — batch insert, per-row fallback on batch error.
  if (toInsert.length > 0) {
    const { error } = await adminClient.from("brand_invitations").insert(toInsert.map((p) => p.insert));
    if (error) {
      for (const p of toInsert) {
        const { error: rowErr } = await adminClient.from("brand_invitations").insert(p.insert);
        if (rowErr) results.failed.push({ row: p.rowNum, reason: rowErr.message, data: p.data });
        else results.success++;
      }
    } else {
      results.success += toInsert.length;
    }
  }

  revalidatePath("/dashboard/brands");
  return results;
}
