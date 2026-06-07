"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { adminGate } from "@/lib/require-super-admin";

export async function deleteInvitation(invitationId: string): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("brand_invitations")
    .delete()
    .eq("id", invitationId)
    .eq("status", "pending");

  if (error) return { error: error.message };

  revalidatePath("/dashboard/brands");
  return { success: true };
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
