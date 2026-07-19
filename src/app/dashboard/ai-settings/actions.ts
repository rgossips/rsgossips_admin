"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { isSuperAdmin } from "@/lib/require-super-admin";

// AI provider config lives in the singleton `ai_config` row (migration 049).
// The API keys are secrets: RLS denies all client roles, so only these
// service-role server actions (super-admin gated) read/write them, and the
// keys are ALWAYS masked before returning to the browser.

const mask = (k?: string | null) => (k ? `••••••••${String(k).slice(-4)}` : "");

export interface AiConfigView {
  ok?: boolean;
  error?: string;
  enabled: boolean;
  active_provider: "anthropic" | "openai" | "gemini";
  models: { cheap: string; standard: string; reasoning: string; multimodal: string };
  keys: {
    anthropic: { set: boolean; masked: string };
    openai: { set: boolean; masked: string };
    gemini: { set: boolean; masked: string };
  };
}

export async function getAiConfig(): Promise<AiConfigView> {
  const blank: AiConfigView = {
    enabled: true,
    active_provider: "anthropic",
    models: { cheap: "", standard: "", reasoning: "", multimodal: "" },
    keys: { anthropic: { set: false, masked: "" }, openai: { set: false, masked: "" }, gemini: { set: false, masked: "" } },
  };
  if (!(await isSuperAdmin())) return { ...blank, error: "Forbidden — super-admin only." };
  const admin = createAdminClient();
  const { data } = await admin.from("ai_config").select("*").eq("id", 1).maybeSingle();
  const c: any = data || {};
  return {
    ok: true,
    enabled: c.enabled ?? true,
    active_provider: c.active_provider || "anthropic",
    models: {
      cheap: c.model_cheap || "",
      standard: c.model_standard || "",
      reasoning: c.model_reasoning || "",
      multimodal: c.model_multimodal || "",
    },
    keys: {
      anthropic: { set: !!c.anthropic_api_key, masked: mask(c.anthropic_api_key) },
      openai: { set: !!c.openai_api_key, masked: mask(c.openai_api_key) },
      gemini: { set: !!c.gemini_api_key, masked: mask(c.gemini_api_key) },
    },
  };
}

export interface AiConfigInput {
  enabled: boolean;
  active_provider: "anthropic" | "openai" | "gemini";
  models: { cheap: string; standard: string; reasoning: string; multimodal: string };
  // Only send a key to CHANGE it. Empty string = leave the stored key untouched.
  keys: { anthropic?: string; openai?: string; gemini?: string };
}

export async function setAiConfig(input: AiConfigInput): Promise<{ ok?: boolean; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Forbidden — super-admin only." };
  const admin = createAdminClient();

  const patch: Record<string, unknown> = {
    id: 1,
    enabled: !!input.enabled,
    active_provider: input.active_provider,
    model_cheap: (input.models.cheap || "").trim(),
    model_standard: (input.models.standard || "").trim(),
    model_reasoning: (input.models.reasoning || "").trim(),
    model_multimodal: (input.models.multimodal || "").trim(),
    updated_at: new Date().toISOString(),
  };
  // Rotate keys only when a new non-empty value is provided.
  const a = (input.keys.anthropic || "").trim();
  const o = (input.keys.openai || "").trim();
  const g = (input.keys.gemini || "").trim();
  if (a) patch.anthropic_api_key = a;
  if (o) patch.openai_api_key = o;
  if (g) patch.gemini_api_key = g;

  const { error } = await admin.from("ai_config").upsert(patch);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/ai-settings");
  return { ok: true };
}

// Optional: clear a stored key (e.g. to fall back to a Supabase env secret).
export async function clearAiKey(provider: "anthropic" | "openai" | "gemini"): Promise<{ ok?: boolean; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Forbidden — super-admin only." };
  const admin = createAdminClient();
  const col = `${provider}_api_key`;
  const { error } = await admin.from("ai_config").update({ [col]: null, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/ai-settings");
  return { ok: true };
}
