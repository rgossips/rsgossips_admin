"use client";

import { useState, useTransition } from "react";
import type { ModelPrice } from "@/lib/ai-pricing";
import { saveModelPricing } from "./actions";

// Collapsed by default — this is a rarely-touched config surface under the
// analytics. Prices shown are the effective ones (override if set, else the
// built-in default); saving writes only the models the admin actually changed.
export function PricingEditor({
  defaults,
  overrides,
}: {
  defaults: Record<string, ModelPrice>;
  overrides: Record<string, Partial<ModelPrice>>;
}) {
  const models = Object.keys(defaults);
  const effective = (m: string): ModelPrice => ({
    in: overrides[m]?.in ?? defaults[m].in,
    out: overrides[m]?.out ?? defaults[m].out,
  });

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, { in: string; out: string }>>(
    Object.fromEntries(models.map((m) => [m, { in: String(effective(m).in), out: String(effective(m).out) }])),
  );
  const [saving, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);

  const set = (m: string, field: "in" | "out", v: string) =>
    setRows((r) => ({ ...r, [m]: { ...r[m], [field]: v.replace(/[^\d.]/g, "") } }));

  const save = () => {
    setMsg(null);
    // Send only models whose in/out differ from the built-in default — keeps
    // the stored override map small and lets a cleared field fall back.
    const payload: Record<string, { in: number; out: number }> = {};
    for (const m of models) {
      const inV = Number(rows[m].in);
      const outV = Number(rows[m].out);
      if (!Number.isFinite(inV) || !Number.isFinite(outV)) continue;
      if (inV !== defaults[m].in || outV !== defaults[m].out) payload[m] = { in: inV, out: outV };
    }
    start(async () => {
      const res = await saveModelPricing(payload);
      if (res.error) setMsg({ err: res.error });
      else setMsg({ ok: "Pricing saved." });
    });
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 cursor-pointer"
      >
        <div className="text-left">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Model pricing (cost estimate)</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">USD per 1M tokens. Overrides the built-in defaults used to estimate cost.</p>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  <th className="py-2 pr-3 whitespace-nowrap">Model</th>
                  <th className="py-2 text-right pl-3 whitespace-nowrap">Input $/1M</th>
                  <th className="py-2 text-right pl-3 whitespace-nowrap">Output $/1M</th>
                  <th className="py-2 text-right pl-3 w-20 whitespace-nowrap">Default?</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const changed = Number(rows[m].in) !== defaults[m].in || Number(rows[m].out) !== defaults[m].out;
                  return (
                    <tr key={m} className="border-t border-gray-50 dark:border-gray-800/50">
                      <td className="py-1.5 pr-3 font-mono text-[11px] whitespace-nowrap text-gray-700 dark:text-gray-200">{m}</td>
                      <td className="py-1.5 pl-3 text-right">
                        <input
                          value={rows[m].in}
                          onChange={(e) => set(m, "in", e.target.value)}
                          inputMode="decimal"
                          className="w-20 px-2 py-1 text-right rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="py-1.5 pl-3 text-right">
                        <input
                          value={rows[m].out}
                          onChange={(e) => set(m, "out", e.target.value)}
                          inputMode="decimal"
                          className="w-20 px-2 py-1 text-right rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="py-1.5 pl-3 text-right text-[11px] whitespace-nowrap text-gray-400">{changed ? "overridden" : "default"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save pricing"}
            </button>
            {msg?.ok && <span className="text-[12px] text-emerald-600">✓ {msg.ok}</span>}
            {msg?.err && <span className="text-[12px] text-red-600">{msg.err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
