"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { adminGate } from "@/lib/require-super-admin";
import type { BrandInvitationDeleteStepKey } from "./delete-invitation-steps";

// Resolves the campaign_ids that reference this invitation so the
// per-step actions can target them. We re-query on every step rather
// than caching client-side because the admin's session is the only place
// we trust the list to live (and the list is small).
async function findLinkedCampaignIds(admin: ReturnType<typeof createAdminClient>, invitationId: string) {
  const { data, error } = await admin
    .from("campaigns")
    .select("campaign_id")
    .eq("brand_invitation_id", invitationId);
  if (error) throw error;
  return (data || []).map((c) => c.campaign_id);
}

// Runs one step of the invited-brand removal flow. Mirrors the per-step
// pattern used by [[deleteInfluencerStep]] / [[deleteBrandStep]] so the
// UI can show progress instead of one opaque "removing…" spinner.
//
// Order matters: `campaign_applications` and `featured_campaigns` must
// run before `campaigns`, and `campaigns` must run before `invitation`,
// otherwise the `campaigns_brand_invitation_id_fkey` FK trips.
export async function deleteBrandInvitationStep(
  invitationId: string,
  step: BrandInvitationDeleteStepKey,
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const gate = await adminGate();
  if (gate) return { ok: false, error: gate.error };

  const admin = createAdminClient();

  try {
    switch (step) {
      case "campaign_applications": {
        const ids = await findLinkedCampaignIds(admin, invitationId);
        if (ids.length === 0) return { ok: true, detail: "No campaigns to clean up" };
        const { error } = await admin
          .from("campaign_applications")
          .delete()
          .in("campaign_id", ids);
        if (error) throw error;
        return { ok: true, detail: `from ${ids.length} campaign(s)` };
      }
      case "featured_campaigns": {
        const ids = await findLinkedCampaignIds(admin, invitationId);
        if (ids.length === 0) return { ok: true, detail: "No campaigns to clean up" };
        // Best-effort — if there's no featured_campaigns row this is a no-op.
        const { error } = await admin
          .from("featured_campaigns")
          .delete()
          .in("campaign_id", ids);
        if (error) throw error;
        return { ok: true };
      }
      case "campaigns": {
        const ids = await findLinkedCampaignIds(admin, invitationId);
        if (ids.length === 0) return { ok: true, detail: "No campaigns to remove" };
        const { error } = await admin
          .from("campaigns")
          .delete()
          .in("campaign_id", ids);
        if (error) throw error;
        revalidatePath("/dashboard/campaigns");
        return { ok: true, detail: `${ids.length} campaign(s) removed` };
      }
      case "invitation": {
        const { error } = await admin
          .from("brand_invitations")
          .delete()
          .eq("id", invitationId)
          .eq("status", "pending");
        if (error) throw error;
        revalidatePath("/dashboard/brands");
        return { ok: true };
      }
      default:
        return { ok: false, error: "Unknown step" };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Step failed" };
  }
}

export async function updateBrandInvitation(invitationId: string, formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const brandName = formData.get("brand_name") as string;
  const instagramUsername = (formData.get("instagram_username") as string)?.replace(/^@/, "").trim();
  const notesText = (formData.get("notes") as string) || "";
  const category = (formData.get("category") as string) || "";
  const instagramVerified = (formData.get("instagram_verified") as string) === "yes";
  // logo_url is optional — only present in the form when the admin
  // uploaded (or cleared) the logo. We treat an empty string as
  // "remove the current logo" rather than skipping the field.
  const logoUrlRaw = formData.get("logo_url");
  const logoTouched = logoUrlRaw !== null;
  const logoUrl = (logoUrlRaw as string | null)?.trim() || null;

  if (!brandName) return { error: "Brand name is required" };
  if (!instagramUsername) return { error: "Instagram username is required" };

  const metadata: Record<string, unknown> = {};
  if (category) metadata.category = category;
  metadata.instagram_verified = instagramVerified;
  let notes = notesText;
  if (Object.keys(metadata).length > 0) {
    notes = notes ? `${notes}\n---\n${JSON.stringify(metadata)}` : JSON.stringify(metadata);
  }

  const adminClient = createAdminClient();
  const updates: Record<string, unknown> = {
    brand_name: brandName,
    instagram_username: instagramUsername,
    notes,
  };
  if (logoTouched) updates.logo_url = logoUrl;
  const { error } = await adminClient
    .from("brand_invitations")
    .update(updates)
    .eq("id", invitationId)
    .eq("status", "pending");

  if (error) return { error: error.message };
  revalidatePath("/dashboard/brands");
  return { success: true };
}
