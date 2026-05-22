"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// ── upload helper ────────────────────────────────────────────────────────
// Uploads service-related images (featured + gallery) to the existing
// campaign-images bucket under a services/ prefix. Reused both via a
// dedicated server action and inline by the form component.

export async function uploadServiceImage(formData: FormData): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file provided" };
  if (!file.type.startsWith("image/")) return { error: "Only images are allowed" };
  if (file.size > 5 * 1024 * 1024) return { error: "File must be under 5MB" };

  const admin = createAdminClient();
  const timestamp = Date.now();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `services/${timestamp}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error } = await admin.storage
    .from("campaign-images")
    .upload(path, Buffer.from(arrayBuffer), { contentType: file.type, upsert: true });
  if (error) return { error: error.message };

  const { data } = admin.storage.from("campaign-images").getPublicUrl(path);
  return { url: data.publicUrl };
}

// ── helpers ──────────────────────────────────────────────────────────────

function parseJsonArray(raw: string | null, fieldLabel: string) {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${fieldLabel} must be a JSON array`);
    return parsed;
  } catch (e: any) {
    throw new Error(`${fieldLabel}: ${e?.message || "invalid JSON"}`);
  }
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Builds the row shape passed to upsert from a FormData.
function readForm(formData: FormData) {
  const title = (formData.get("title") as string || "").trim();
  const slugRaw = (formData.get("slug") as string || "").trim();
  const slug = slugRaw || slugify(title);

  const tag = (formData.get("tag") as string || "").trim().toUpperCase();
  const description = (formData.get("description") as string || "").trim();
  const about = (formData.get("about") as string || "").trim();
  const included = parseJsonArray(formData.get("included") as string, "Included");
  const packages = parseJsonArray(formData.get("packages") as string, "Packages");
  const price_starting = parseInt((formData.get("price_starting") as string) || "0", 10) || 0;
  const priceToRaw = formData.get("price_to") as string;
  const price_to = priceToRaw ? parseInt(priceToRaw, 10) || null : null;
  const price_suffix = ((formData.get("price_suffix") as string) || "").trim() || null;
  const quote_sla_hours = parseInt((formData.get("quote_sla_hours") as string) || "24", 10) || 24;
  const delivery_days = ((formData.get("delivery_days") as string) || "").trim();
  const payment_split = ((formData.get("payment_split") as string) || "50/50").trim();
  const hero_gradient = ((formData.get("hero_gradient") as string) || "from-violet-500 via-fuchsia-500 to-pink-500").trim();
  const accent = ((formData.get("accent") as string) || "bg-slate-100 text-slate-600").trim();
  const icon_name = ((formData.get("icon_name") as string) || "Sparkles").trim();
  const is_active = formData.get("is_active") === "on" || formData.get("is_active") === "true";
  const display_order = parseInt((formData.get("display_order") as string) || "0", 10) || 0;

  // Media — featured image + gallery (mixed images + video URLs)
  const featured_image_url = ((formData.get("featured_image_url") as string) || "").trim() || null;
  const galleryRaw = parseJsonArray(formData.get("gallery") as string, "Gallery");
  const gallery = galleryRaw
    .map((g: any) => ({
      type: g?.type === "video" ? "video" : "image",
      url: (g?.url || "").toString().trim(),
      caption: (g?.caption || "").toString().trim(),
    }))
    .filter((g) => !!g.url);

  // Normalise included → array of non-empty strings.
  const includedClean = (Array.isArray(included) ? included : [])
    .map((s: any) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);

  // Normalise packages → array of { name, spec, price }
  const packagesClean = (Array.isArray(packages) ? packages : [])
    .map((p: any) => ({
      name: (p?.name || "").toString().trim(),
      spec: (p?.spec || "").toString().trim(),
      price: Number(p?.price) || 0,
    }))
    .filter((p) => !!p.name);

  return {
    slug,
    tag,
    title,
    description,
    about,
    included: includedClean,
    packages: packagesClean,
    price_starting,
    price_to,
    price_suffix,
    quote_sla_hours,
    delivery_days,
    payment_split,
    hero_gradient,
    accent,
    icon_name,
    is_active,
    display_order,
    featured_image_url,
    gallery,
  };
}

// ── actions ──────────────────────────────────────────────────────────────

export async function createService(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  let row;
  try {
    row = readForm(formData);
  } catch (e: any) {
    return { error: e.message };
  }
  if (!row.title) return { error: "Title is required" };
  if (!row.tag) return { error: "Category tag is required" };

  const admin = createAdminClient();
  const { error } = await admin.from("services").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/services");
  redirect("/dashboard/services");
}

export async function updateService(id: string, formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  let row;
  try {
    row = readForm(formData);
  } catch (e: any) {
    return { error: e.message };
  }
  if (!row.title) return { error: "Title is required" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("services")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/services");
  revalidatePath(`/dashboard/services/${id}/edit`);
  redirect("/dashboard/services");
}

export async function toggleServiceActive(id: string, nextValue: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("services")
    .update({ is_active: nextValue, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function deleteService(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  // Soft delete: just set is_active=false. Hard delete would orphan any
  // service_orders snapshotted against this service.
  const { error } = await admin
    .from("services")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/services");
  return { ok: true };
}
