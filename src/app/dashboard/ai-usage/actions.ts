"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { isSuperAdmin } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";

// Persists per-model price overrides into ai_config.model_pricing (migration
// 052). Super-admin only — it's the same singleton that holds the API keys.
// Shape: { "<model>": { "in": <usd/1M in>, "out": <usd/1M out> } }.
export async function saveModelPricing(
  overrides: Record<string, { in: number; out: number }>,
): Promise<{ ok?: boolean; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Forbidden — super-admin only." };

  // Sanitise: keep only finite, non-negative numbers under sane bounds so a
  // fat-fingered value can't wildly skew every cost figure.
  const clean: Record<string, { in: number; out: number }> = {};
  for (const [model, p] of Object.entries(overrides || {})) {
    if (!model || typeof p !== "object" || !p) continue;
    const inV = Number(p.in);
    const outV = Number(p.out);
    if (!Number.isFinite(inV) || !Number.isFinite(outV)) continue;
    if (inV < 0 || outV < 0 || inV > 10_000 || outV > 10_000) continue;
    clean[model.slice(0, 100)] = { in: inV, out: outV };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_config")
    .update({ model_pricing: clean, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) {
    logError("ai-usage.saveModelPricing", error);
    return { error: "Could not save pricing." };
  }
  revalidatePath("/dashboard/ai-usage");
  return { ok: true };
}
