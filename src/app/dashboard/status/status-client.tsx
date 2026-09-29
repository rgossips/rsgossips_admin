"use client";

import { useState } from "react";
import { GROUP_BLURB, GROUP_LABEL, type CheckGroup, type CheckResult, type CheckState } from "@/lib/status/targets";
import { runStatusChecks } from "./actions";

const ORDER: CheckGroup[] = ["core", "functions", "sites", "external", "config"];

const STATE_STYLE: Record<CheckState, { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "OK" },
  slow: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "Slow" },
  down: { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", label: "Problem" },
  skipped: { dot: "bg-gray-300 dark:bg-gray-600", text: "text-gray-400 dark:text-gray-500", label: "Not checked" },
};

// Fixed IST, same string on server and client — no hydration mismatch.
const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function StatusClient() {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setError("");
    const res = await runStatusChecks();
    setRunning(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResults(res.results ?? []);
    setCheckedAt(res.checkedAt ?? null);
  };

  const problems = results?.filter((r) => r.state === "down").length ?? 0;
  const slow = results?.filter((r) => r.state === "slow").length ?? 0;

  return (
    <div className="space-y-5">
      {/* Run bar — sticky on phones so the button is always reachable. */}
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border sm:border-gray-200 sm:bg-white sm:px-4 dark:border-gray-800 dark:bg-gray-950/95 sm:dark:bg-gray-900">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
          aria-busy={running}
        >
          {running ? (
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {running ? "Checking…" : results ? "Check again" : "Run checks"}
        </button>

        {checkedAt && (
          <span className="text-[12px] text-gray-500 dark:text-gray-400">
            Last checked {TIME_FMT.format(new Date(checkedAt))} IST
          </span>
        )}
        {results && (
          <span className="ml-auto flex items-center gap-3 text-[12px] font-semibold">
            {problems > 0 ? (
              <span className="text-rose-600 dark:text-rose-400">{problems} problem{problems === 1 ? "" : "s"}</span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">All good</span>
            )}
            {slow > 0 && <span className="text-amber-600 dark:text-amber-400">{slow} slow</span>}
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
          {error}
        </p>
      )}

      {!results && !running && (
        <div className="rounded-2xl border border-dashed border-gray-300 px-5 py-10 text-center dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Nothing has been checked yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-gray-500 dark:text-gray-400">
            Checks run only when you press the button — each one costs a real request, so this page never polls on its own.
          </p>
        </div>
      )}

      {results &&
        ORDER.map((group) => {
          const rows = results.filter((r) => r.group === group);
          if (rows.length === 0) return null;
          const bad = rows.filter((r) => r.state === "down").length;
          return (
            <section key={group} className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-white">{GROUP_LABEL[group]}</h2>
                  {bad > 0 && (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                      {bad}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">{GROUP_BLURB[group]}</p>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((r) => {
                  const st = STATE_STYLE[r.state];
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 break-words text-[13px] font-medium text-gray-900 dark:text-gray-100">
                        {r.label}
                      </span>
                      <span className={`text-[12px] font-bold ${st.text}`}>{st.label}</span>
                      {r.ms != null && (
                        <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-gray-400">{r.ms} ms</span>
                      )}
                      {r.detail && (
                        <span className="w-full break-words pl-5 text-[12px] text-gray-500 dark:text-gray-400">{r.detail}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
