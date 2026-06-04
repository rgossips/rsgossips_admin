"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { revalidatePath } from "next/cache";
import type { BrandDeleteStepKey } from "./delete-steps";

export async function deleteBrandStep(
  brandId: string,
  step: BrandDeleteStepKey,
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  try {
    await requireSuperAdmin();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Forbidden" };
  }

  const admin = createAdminClient();

  try {
    switch (step) {
      case "campaign_applications": {
        // Delete all applications for campaigns owned by this brand
        const { data: camps } = await admin
          .from("campaigns")
          .select("campaign_id")
          .eq("brand_id", brandId);
        const campIds = (camps || []).map((c) => c.campaign_id);
        if (campIds.length === 0) return { ok: true, detail: "No campaigns" };
        const { error } = await admin
          .from("campaign_applications")
          .delete()
          .in("campaign_id", campIds);
        if (error) throw error;
        return { ok: true, detail: `from ${campIds.length} campaign(s)` };
      }
      case "campaigns": {
        const { error } = await admin
          .from("campaigns")
          .delete()
          .eq("brand_id", brandId);
        if (error) throw error;
        return { ok: true };
      }
      case "service_orders": {
        const { data: orders } = await admin
          .from("service_orders")
          .select("id")
          .eq("user_id", brandId);
        const orderIds = (orders || []).map((o) => o.id);
        if (orderIds.length > 0) {
          await admin.from("service_order_events").delete().in("order_id", orderIds);
        }
        const { error } = await admin
          .from("service_orders")
          .delete()
          .eq("user_id", brandId);
        if (error) throw error;
        return { ok: true, detail: `${orderIds.length} order(s) removed` };
      }
      case "brand_invitations": {
        const { error } = await admin
          .from("brand_invitations")
          .update({ status: "pending", claimed_by: null, claimed_at: null, brand_profile_id: null })
          .eq("claimed_by", brandId);
        if (error) throw error;
        return { ok: true };
      }
      case "brand_profile": {
        const { error } = await admin
          .from("brand_profiles")
          .delete()
          .eq("brand_id", brandId);
        if (error) throw error;
        return { ok: true };
      }
      case "auth_user": {
        const { error } = await admin.auth.admin.deleteUser(brandId);
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
