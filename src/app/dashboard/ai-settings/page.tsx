"use client";

import { useEffect, useState } from "react";
import { getAiConfig, setAiConfig, clearAiKey, type AiConfigView } from "./actions";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (GPT)" },
  { id: "gemini", label: "Google (Gemini)" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];
type ClassKey = "cheap" | "standard" | "reasoning" | "multimodal";

const CLASSES = [
  { key: "cheap", label: "Cheap", hint: "captions · hashtags · hooks (high volume)" },
  { key: "standard", label: "Standard", hint: "scripts · brief · media kit" },
  { key: "reasoning", label: "Reasoning", hint: "pitch · rate card · match coach · copilot" },
  { key: "multimodal", label: "Multimodal", hint: "video / image pre-flight" },
] as const;

// Model suggestions per provider (shown in the dropdown for the active
// provider). These are the models known to work with the `_shared/ai.ts`
// adapter's request shape — the OpenAI list deliberately stays on the
// gpt-4o/4.1 family, which accept `max_tokens` + `temperature` (the o-series
// / GPT-5 need `max_completion_tokens`, which the adapter doesn't send yet).
const PROVIDER_MODELS: Record<ProviderId, string[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-fable-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
};

// Sensible default model per task class, per provider — used to auto-fill when
// the provider is switched and the current value belonged to another provider.
const PROVIDER_DEFAULTS: Record<ProviderId, Record<ClassKey, string>> = {
  anthropic: { cheap: "claude-haiku-4-5-20251001", standard: "claude-sonnet-5", reasoning: "claude-sonnet-5", multimodal: "claude-sonnet-5" },
  openai: { cheap: "gpt-4o-mini", standard: "gpt-4o", reasoning: "gpt-4o", multimodal: "gpt-4o" },
  gemini: { cheap: "gemini-1.5-flash", standard: "gemini-1.5-pro", reasoning: "gemini-1.5-pro", multimodal: "gemini-1.5-pro" },
};

// Which provider a model string belongs to (null = unrecognised / custom).
const providerOfModel = (m: string): ProviderId | null =>
  (PROVIDERS.find((p) => PROVIDER_MODELS[p.id].includes(m))?.id as ProviderId) ?? null;

const input = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

export default function AiSettingsPage() {
  const [cfg, setCfg] = useState<AiConfigView | null>(null);
  const [keys, setKeys] = useState<{ anthropic: string; openai: string; gemini: string }>({ anthropic: "", openai: "", gemini: "" });
  const [customCls, setCustomCls] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);

  const load = async () => setCfg(await getAiConfig());
  useEffect(() => { load(); }, []);

  if (!cfg) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (cfg.error) return <div className="p-6 text-sm text-red-500">{cfg.error}</div>;

  const patch = (fn: (c: AiConfigView) => AiConfigView) => setCfg((c) => (c ? fn(c) : c));

  // Switching provider re-points each task class's model. A value that clearly
  // belongs to a DIFFERENT provider (or is blank) is swapped to the new
  // provider's default; a genuinely custom (unrecognised) value is preserved.
  const switchProvider = (pid: ProviderId) =>
    patch((c) => {
      const models = { ...c.models } as Record<ClassKey, string>;
      (["cheap", "standard", "reasoning", "multimodal"] as ClassKey[]).forEach((cls) => {
        const cur = models[cls];
        const owner = providerOfModel(cur);
        if (!cur || (owner && owner !== pid)) models[cls] = PROVIDER_DEFAULTS[pid][cls];
      });
      return { ...c, active_provider: pid, models };
    });

  // Reset explicit custom-mode flags whenever the provider changes; a truly
  // custom value still shows its text field (derived from "not in options").
  const onProvider = (pid: ProviderId) => { setCustomCls({}); switchProvider(pid); };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const res = await setAiConfig({
      enabled: cfg.enabled,
      active_provider: cfg.active_provider,
      models: cfg.models,
      keys: { anthropic: keys.anthropic, openai: keys.openai, gemini: keys.gemini },
    });
    setSaving(false);
    if (res.error) return setMsg({ text: res.error });
    setKeys({ anthropic: "", openai: "", gemini: "" });
    await load();
    setMsg({ ok: true, text: "Saved." });
  };

  const clear = async (p: "anthropic" | "openai" | "gemini") => {
    if (!confirm(`Clear the stored ${p} API key? The adapter will fall back to a Supabase env secret if one is set.`)) return;
    await clearAiKey(p);
    await load();
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Choose the AI provider + model per task class and manage API keys. Keys are stored securely and never shown in full. Changes take effect within ~30s.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => patch((c) => ({ ...c, enabled: e.target.checked }))} />
          AI enabled
        </label>
      </div>

      {/* Provider */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">Active provider</h2>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => onProvider(p.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                cfg.active_provider === p.id
                  ? "bg-indigo-500 text-white border-indigo-500"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-indigo-300"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* Models per task class — options follow the active provider */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
          Model per task class
          <span className="ml-2 font-normal text-xs text-gray-400">{PROVIDERS.find((p) => p.id === cfg.active_provider)?.label} models</span>
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {CLASSES.map((k) => {
            const value = (cfg.models as any)[k.key] as string;
            const options = PROVIDER_MODELS[cfg.active_provider as ProviderId];
            const isCustom = !!customCls[k.key] || (!!value && !options.includes(value));
            return (
              <label key={k.key} className="space-y-1">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{k.label}<span className="font-normal text-gray-400"> — {k.hint}</span></span>
                <select
                  className={input}
                  value={isCustom ? "__custom__" : value}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setCustomCls((s) => ({ ...s, [k.key]: true }));
                      patch((c) => ({ ...c, models: { ...c.models, [k.key]: "" } }));
                    } else {
                      setCustomCls((s) => ({ ...s, [k.key]: false }));
                      patch((c) => ({ ...c, models: { ...c.models, [k.key]: e.target.value } }));
                    }
                  }}
                >
                  {options.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {isCustom && (
                  <input
                    className={input}
                    value={value}
                    onChange={(e) => patch((c) => ({ ...c, models: { ...c.models, [k.key]: e.target.value } }))}
                    placeholder="type a custom model id"
                    autoFocus
                  />
                )}
              </label>
            );
          })}
        </div>
      </section>

      {/* API keys */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">API keys</h2>
        {(["anthropic", "openai", "gemini"] as const).map((p) => (
          <div key={p} className="flex items-end gap-3">
            <label className="flex-1 space-y-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 capitalize">
                {p} key {cfg.keys[p].set ? <span className="text-emerald-500">· set ({cfg.keys[p].masked})</span> : <span className="text-amber-500">· not set</span>}
              </span>
              <input
                className={input}
                type="password"
                value={keys[p]}
                onChange={(e) => setKeys((s) => ({ ...s, [p]: e.target.value }))}
                placeholder={cfg.keys[p].set ? "•••• leave blank to keep, or paste a new key to rotate" : "paste API key"}
                autoComplete="off"
              />
            </label>
            {cfg.keys[p].set && (
              <button onClick={() => clear(p)} className="px-3 py-2 text-xs font-semibold text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                Clear
              </button>
            )}
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-indigo-500 text-white text-sm font-bold hover:bg-indigo-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {msg && <span className={`text-sm font-medium ${msg.ok ? "text-emerald-500" : "text-red-500"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
