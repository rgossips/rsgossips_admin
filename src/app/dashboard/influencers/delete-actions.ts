"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireSuperAdmin } from "@/lib/require-super-admin";
import { revalidatePath } from "next/cache";
import type { InfluencerDeleteStepKey } from "./delete-steps";

export async function deleteInfluencerStep(
  influencerId: string,
  step: InfluencerDeleteStepKey,
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  try {
    await requireSuperAdmin();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Forbidden" };
  }

  const admin = createAdminClient();

  try {
    switch (step) {
      case "creator_stories": {
        // creator_stories references the influencer by username (matches IG handle)
        const { data: inf } = await admin
          .from("influencer_profiles")
          .select("instagram_handle, username")
          .eq("influencer_id", influencerId)
          .maybeSingle();
        const handles = [inf?.instagram_handle, inf?.username].filter(Boolean) as string[];
        if (handles.length === 0) return { ok: true, detail: "No handle to match" };
        const { error } = await admin
          .from("creator_stories")
          .delete()
          .in("username", handles);
        if (error) throw error;
        return { ok: true };
      }
      case "featured_creators": {
        const { error } = await admin
          .from("featured_creators")
          .delete()
          .eq("influencer_id", influencerId);
        if (error) throw error;
        return { ok: true };
      }
      case "campaign_applications": {
        const { error } = await admin
          .from("campaign_applications")
          .delete()
          .eq("influencer_id", influencerId);
        if (error) throw error;
        return { ok: true };
      }
      case "service_orders": {
        // Delete events first (FK to orders), then the orders themselves
        const { data: orders } = await admin
          .from("service_orders")
          .select("id")
          .eq("user_id", influencerId);
        const orderIds = (orders || []).map((o) => o.id);
        if (orderIds.length > 0) {
          await admin.from("service_order_events").delete().in("order_id", orderIds);
        }
        const { error } = await admin
          .from("service_orders")
          .delete()
          .eq("user_id", influencerId);
        if (error) throw error;
        return { ok: true, detail: `${orderIds.length} order(s) removed` };
      }
      case "influencer_invitations": {
        // Don't delete the invitation — null out the claim so the slot can be re-claimed if needed
        const { error } = await admin
          .from("influencer_invitations")
          .update({ status: "pending", claimed_by: null, claimed_at: null, influencer_profile_id: null })
          .eq("claimed_by", influencerId);
        if (error) throw error;
        return { ok: true };
      }
      case "influencer_profile": {
        const { error } = await admin
          .from("influencer_profiles")
          .delete()
          .eq("influencer_id", influencerId);
        if (error) throw error;
        return { ok: true };
      }
      case "auth_user": {
        const { error } = await admin.auth.admin.deleteUser(influencerId);
        if (error) throw error;
        revalidatePath("/dashboard/influencers");
        return { ok: true };
      }
      default:
        return { ok: false, error: "Unknown step" };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Step failed" };
  }
}
