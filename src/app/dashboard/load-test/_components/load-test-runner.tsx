"use client";

import { useState } from "react";
import { runLoadTest, type ScenarioResult } from "../actions";
import { ButtonSpinner } from "@/components/spinner";

const inputClass =
  "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";

export function LoadTestRunner({ scenarios }: { scenarios: { id: string; label: string }[] }) {
  const [selected, setSelected] = useState<string[]>(scenarios.map((s) => s.id));
  const [vus, setVus] = useState(10);
  const [iterations, setIterations] = useState(10);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const totalRequests = selected.length * vus * iterations;

  const run = async () => {
    setRunning(true);
    setError("");
    setResults(null);
    try {
      const res = await runLoadTest({ scenarioIds: selected, vus, iterations });
      if (res.error) setError(res.error);
      else {
        setResults(res.results || []);
        setRanAt(res.ranAt || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load test failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Config */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Scenarios</p>
        <div className="space-y-2">
          {scenarios.map((s) => (
            <label key={s.id} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
              />
              {s.label}
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-md">
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Virtual users <span className="text-gray-400">(max 20)</span>
            </label>
            <input type="number" min={1} max={20} value={vus} onChange={(e) => setVus(Number(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Iterations / user <span className="text-gray-400">(max 20)</span>
            </label>
            <input type="number" min={1} max={20} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} className={inputClass} />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={run}
            disabled={running || selected.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            {running && <ButtonSpinner />}
            {running ? "Running…" : "Run Load Test"}
          </button>
          <p className="text-[12px] text-gray-400">
            {totalRequests.toLocaleString()} total requests ({selected.length} scenario{selected.length === 1 ? "" : "s"} × {vus} × {iterations}), run sequentially per scenario
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Results</p>
            {ranAt && (
              <p className="text-[11px] text-gray-400">
                {new Date(ranAt).toLocaleString("en-IN")}
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="px-5 py-3">Scenario</th>
                  <th className="px-3 py-3 text-right">OK / Total</th>
                  <th className="px-3 py-3 text-right">Errors</th>
                  <th className="px-3 py-3 text-right">req/s</th>
                  <th className="px-3 py-3 text-right">p50 ms</th>
                  <th className="px-3 py-3 text-right">p95 ms</th>
                  <th className="px-3 py-3 text-right">max ms</th>
                  <th className="px-5 py-3 text-right">avg KB</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {results.map((r) => {
                  const healthy = r.errors === 0 && (r.p95 ?? 0) < 2000;
                  return (
                    <tr key={r.id}>
                      <td className="px-5 py-3 text-gray-900 dark:text-white font-medium">
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${healthy ? "bg-emerald-500" : "bg-red-500"}`} />
                        {r.label}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{r.ok}/{r.total}</td>
                      <td className={`px-3 py-3 text-right font-semibold ${r.errors > 0 ? "text-red-600" : "text-gray-400"}`}>{r.errors}</td>
                      <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{r.rps}</td>
                      <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{r.p50 ?? "—"}</td>
                      <td className={`px-3 py-3 text-right font-semibold ${(r.p95 ?? 0) >= 2000 ? "text-amber-600" : "text-gray-700 dark:text-gray-300"}`}>{r.p95 ?? "—"}</td>
                      <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{r.max ?? "—"}</td>
                      <td className="px-5 py-3 text-right text-gray-700 dark:text-gray-300">{r.avgKB ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
            Green dot: zero errors and p95 under 2s. Baseline (2026-07): p50 ≈ 450ms, p95 &lt; 1s at 10 VUs.
          </p>
        </div>
      )}
    </div>
  );
}
