"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

// Stays in lockstep with public.featured_brands (migration 020). Display
// fields are denormalised at add-time so the influencer carousel renders
// without a join.

export async function addFeaturedBrand(payload: {
  brand_id?: string | null;
  brand_invitation_id?: string | null;
  name: string;
  logo_url?: string;
  instagram_url?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!payload.name) return { error: "Brand name is required" };

  const admin = createAdminClient();
  const { data: tail } = await admin
    .from("featured_brands")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (tail?.position ?? -1) + 1;

  const { error } = await admin.from("featured_brands").insert({
    brand_id: payload.brand_id || null,
    brand_invitation_id: payload.brand_invitation_id || null,
    name: payload.name,
    logo_url: payload.logo_url || null,
    instagram_url: payload.instagram_url || null,
    position,
    is_active: true,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-brands");
  return { ok: true };
}

export async function toggleFeaturedBrandActive(id: string, nextValue: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("featured_brands")
    .update({ is_active: nextValue })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-brands");
  return { ok: true };
}

export async function deleteFeaturedBrand(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin.from("featured_brands").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-brands");
  return { ok: true };
}

export async function moveFeaturedBrand(id: string, direction: "up" | "down") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("featured_brands")
    .select("position")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Row not found" };

  const newPos = direction === "up" ? row.position - 1 : row.position + 1;
  const { error } = await admin
    .from("featured_brands")
    .update({ position: newPos })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/featured-brands");
  return { ok: true };
}

// Picker — searches both registered brands and pending invitations by
// name or Instagram handle. Hides brands already featured. Returns the
// denormalised display fields the add action needs.
export async function searchBrandsForFeature(query: string) {
  const admin = createAdminClient();
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const [profilesRes, invitesRes] = await Promise.all([
    admin
      .from("brand_profiles")
      .select("brand_id, brand_name, gstin_trade_name, logo_url, instagram_username")
      .or(`brand_name.ilike.${like},gstin_trade_name.ilike.${like},instagram_username.ilike.${like}`)
      .limit(15),
    admin
      .from("brand_invitations")
      .select("id, brand_name, logo_url, instagram_username")
      .or(`brand_name.ilike.${like},instagram_username.ilike.${like}`)
      .limit(15),
  ]);

  const { data: already } = await admin
    .from("featured_brands")
    .select("brand_id, brand_invitation_id");
  const featuredBrandIds = new Set((already || []).map((r: any) => r.brand_id).filter(Boolean));
  const featuredInvIds = new Set((already || []).map((r: any) => r.brand_invitation_id).filter(Boolean));

  const igUrl = (handle: string | null) =>
    handle ? `https://www.instagram.com/${handle.replace(/^@/, "")}/` : "";

  const registered = (profilesRes.data || [])
    .filter((b: any) => !featuredBrandIds.has(b.brand_id))
    .map((b: any) => ({
      kind: "brand" as const,
      ref_id: b.brand_id,
      name: b.gstin_trade_name || b.brand_name || (b.instagram_username ? `@${b.instagram_username}` : "Unnamed brand"),
      logo_url: b.logo_url || "",
      instagram_url: igUrl(b.instagram_username),
    }));

  const invited = (invitesRes.data || [])
    .filter((b: any) => !featuredInvIds.has(b.id))
    .map((b: any) => ({
      kind: "invitation" as const,
      ref_id: b.id,
      name: b.brand_name || (b.instagram_username ? `@${b.instagram_username}` : "Unnamed brand"),
      logo_url: b.logo_url || "",
      instagram_url: igUrl(b.instagram_username),
    }));

  return [...registered, ...invited];
}
