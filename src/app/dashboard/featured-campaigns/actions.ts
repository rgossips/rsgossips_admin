"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { adminGate, viewerGate } from "@/lib/require-super-admin";
import { sanitizeSearchTerm } from "@/lib/validation";

// Stays in lockstep with public.featured_campaigns (migration 019)
// + the section column added in migration 033. Featured Campaigns
// (top StackedDeals strip) and Plan Your Stay (StayCarousel) share
// this table but live in different `section` partitions:
//   section='campaign' → /dashboard/featured-campaigns (this file)
//   section='stay'     → /dashboard/featured-stay
const SECTION = "campaign" as const;

// homepage_settings key for the section title. The campaign-strip
// title is new (currently unused in the influencer UI but ready for
// when StackedDeals gets a heading). Plan Your Stay keeps the
// historical featured_section_title key.
const SECTION_TITLE_KEY = "featured_campaigns_section_title";
const DEFAULT_SECTION_TITLE = "FEATURED CAMPAIGNS";

export async function getFeaturedSectionTitle(): Promise<string> {
  if (await viewerGate()) return DEFAULT_SECTION_TITLE;
  const admin = createAdminClient();
  const { data } = await admin
    .from("homepage_settings")
    .select("value")
    .eq("key", SECTION_TITLE_KEY)
    .maybeSingle();
  return data?.value || DEFAULT_SECTION_TITLE;
}

export async function setFeaturedSectionTitle(value: string): Promise<{ error?: string; ok?: boolean }> {
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

  revalidatePath("/dashboard/featured-campaigns");
  return { ok: true };
}

export async function addFeaturedCampaign(campaignId: string, position?: number): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  let pos = position ?? 0;
  if (position == null) {
    const { data: tail } = await admin
      .from("featured_campaigns")
      .select("position")
      .eq("section", SECTION)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    pos = (tail?.position ?? -1) + 1;
  }

  const { error } = await admin
    .from("featured_campaigns")
    .insert({ campaign_id: campaignId, position: pos, is_active: true, section: SECTION });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-campaigns");
  return { ok: true };
}

export async function toggleFeaturedCampaignActive(id: string, nextValue: boolean): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { error } = await admin
    .from("featured_campaigns")
    .update({ is_active: nextValue })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-campaigns");
  return { ok: true };
}

export async function deleteFeaturedCampaign(id: string): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { error } = await admin.from("featured_campaigns").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-campaigns");
  return { ok: true };
}

export async function moveFeaturedCampaign(id: string, direction: "up" | "down"): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("featured_campaigns")
    .select("position")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Row not found" };

  const newPos = direction === "up" ? row.position - 1 : row.position + 1;
  const { error } = await admin
    .from("featured_campaigns")
    .update({ position: newPos })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-campaigns");
  return { ok: true };
}

// Picker — searches campaigns by title or brand name. Joins through to
// brand_profiles / brand_invitations so admin can find a campaign by its
// brand even if the campaign title is generic.
export async function searchCampaignsForFeature(query: string) {
  const gate = await adminGate();
  if (gate) return [];
  const admin = createAdminClient();
  const q = sanitizeSearchTerm(query);
  if (!q) return [];
  const like = `%${q}%`;

  // Direct title match first
  const { data: byTitle } = await admin
    .from("campaigns")
    .select("campaign_id, title, brand_id, brand_invitation_id, status, application_deadline")
    .ilike("title", like)
    .limit(15);

  // Brand name match — look up matching brand rows then pull their campaigns
  const [{ data: bp }, { data: bi }] = await Promise.all([
    admin
      .from("brand_profiles")
      .select("brand_id, brand_name, gstin_trade_name, logo_url")
      .or(`brand_name.ilike.${like},gstin_trade_name.ilike.${like}`)
      .limit(10),
    admin
      .from("brand_invitations")
      .select("id, brand_name, logo_url")
      .ilike("brand_name", like)
      .limit(10),
  ]);

  const brandIds = (bp || []).map((b: any) => b.brand_id);
  const invIds = (bi || []).map((b: any) => b.id);
  let byBrand: any[] = [];
  if (brandIds.length > 0 || invIds.length > 0) {
    const { data } = await admin
      .from("campaigns")
      .select("campaign_id, title, brand_id, brand_invitation_id, status, application_deadline")
      .or(
        [
          brandIds.length > 0 ? `brand_id.in.(${brandIds.join(",")})` : null,
          invIds.length > 0 ? `brand_invitation_id.in.(${invIds.join(",")})` : null,
        ]
          .filter(Boolean)
          .join(",")
      )
      .limit(15);
    byBrand = data || [];
  }

  const seen = new Set<string>();
  const merged = [...(byTitle || []), ...byBrand].filter((c: any) => {
    if (seen.has(c.campaign_id)) return false;
    seen.add(c.campaign_id);
    return true;
  });

  const brandMap: Record<string, { name: string; logo: string }> = {};
  (bp || []).forEach((p: any) => {
    brandMap[p.brand_id] = { name: p.gstin_trade_name || p.brand_name || "", logo: p.logo_url || "" };
  });
  (bi || []).forEach((inv: any) => {
    brandMap[inv.id] = { name: inv.brand_name || "", logo: inv.logo_url || "" };
  });

  const missingBrandIds = merged
    .filter((c) => c.brand_id && !brandMap[c.brand_id])
    .map((c) => c.brand_id);
  const missingInvIds = merged
    .filter((c) => c.brand_invitation_id && !brandMap[c.brand_invitation_id])
    .map((c) => c.brand_invitation_id);
  if (missingBrandIds.length > 0) {
    const { data } = await admin
      .from("brand_profiles")
      .select("brand_id, brand_name, gstin_trade_name, logo_url")
      .in("brand_id", missingBrandIds);
    (data || []).forEach((p: any) => {
      brandMap[p.brand_id] = { name: p.gstin_trade_name || p.brand_name || "", logo: p.logo_url || "" };
    });
  }
  if (missingInvIds.length > 0) {
    const { data } = await admin
      .from("brand_invitations")
      .select("id, brand_name, logo_url")
      .in("id", missingInvIds);
    (data || []).forEach((inv: any) => {
      brandMap[inv.id] = { name: inv.brand_name || "", logo: inv.logo_url || "" };
    });
  }

  // Hide campaigns already featured in THIS section (admin can still
  // feature the same campaign in the other section if they want).
  const { data: already } = await admin
    .from("featured_campaigns")
    .select("campaign_id")
    .eq("section", SECTION);
  const alreadyIds = new Set((already || []).map((r: any) => r.campaign_id));

  return merged
    .filter((c) => !alreadyIds.has(c.campaign_id))
    .map((c) => {
      const brand = brandMap[c.brand_invitation_id] || brandMap[c.brand_id] || { name: "Unknown Brand", logo: "" };
      return {
        campaign_id: c.campaign_id,
        title: c.title,
        status: c.status,
        applicationDeadline: c.application_deadline,
        brandName: brand.name,
        brandLogo: brand.logo,
      };
    });
}
