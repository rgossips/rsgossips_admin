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

// The order the tiles read in: worst first, because that is what the page is
// opened to find out.
const STATE_ORDER: CheckState[] = ["down", "slow", "ok", "skipped"];

const TILE_TONE: Record<CheckState, { on: string; off: string }> = {
  down: {
    on: "border-rose-400 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/30",
    off: "border-rose-200 bg-white hover:bg-rose-50/60 dark:border-rose-900/60 dark:bg-gray-900 dark:hover:bg-rose-900/20",
  },
  slow: {
    on: "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30",
    off: "border-amber-200 bg-white hover:bg-amber-50/60 dark:border-amber-900/60 dark:bg-gray-900 dark:hover:bg-amber-900/20",
  },
  ok: {
    on: "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/30",
    off: "border-emerald-200 bg-white hover:bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-gray-900 dark:hover:bg-emerald-900/20",
  },
  skipped: {
    on: "border-gray-400 bg-gray-100 dark:border-gray-600 dark:bg-gray-800",
    off: "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800",
  },
};

// Module scope, not nested in the component: a subcomponent redeclared on
// every render remounts its children and loses focus (CLAUDE.md, "Client
// component pitfalls").
function Tile({
  state,
  count,
  active,
  onClick,
}: {
  state: CheckState;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const st = STATE_STYLE[state];
  const tone = TILE_TONE[state];
  // A tile with nothing in it is not a filter — pressing it would empty the
  // page and say nothing useful. The number still shows, because "0
  // problems" is the answer this page exists to give.
  const selectable = count > 0;
  return (
    <button
      type="button"
      onClick={selectable ? onClick : undefined}
      aria-pressed={active}
      disabled={!selectable}
      title={selectable ? `Show only the ${st.label.toLowerCase()} checks` : `Nothing is ${st.label.toLowerCase()}`}
      className={`flex min-w-[104px] flex-1 flex-col gap-0.5 rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-default disabled:opacity-60 ${
        active ? tone.on : tone.off
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden="true" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {st.label}
        </span>
      </span>
      <span className={`text-2xl font-bold tabular-nums ${count > 0 ? st.text : "text-gray-300 dark:text-gray-600"}`}>
        {count}
      </span>
    </button>
  );
}

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
  // Filters deliberately SURVIVE a re-run: you filter to Problem, fix the
  // thing, and press Check again to see whether it cleared. The empty state
  // below says so out loud, because an empty page after a re-run otherwise
  // reads as "nothing ran".
  const [stateFilter, setStateFilter] = useState<CheckState | "all">("all");
  const [groupFilter, setGroupFilter] = useState<CheckGroup | "all">("all");
  const [q, setQ] = useState("");

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

  const all = results ?? [];
  const problems = all.filter((r) => r.state === "down").length;
  const slow = all.filter((r) => r.state === "slow").length;

  // Counts come from the WHOLE run, never from the filtered view: a tile
  // that changed when you pressed another tile would stop being a summary.
  const stateCounts = STATE_ORDER.reduce<Record<CheckState, number>>(
    (acc, s) => ({ ...acc, [s]: all.filter((r) => r.state === s).length }),
    { ok: 0, slow: 0, down: 0, skipped: 0 },
  );

  const term = q.trim().toLowerCase();
  const visible = all.filter((r) => {
    if (stateFilter !== "all" && r.state !== stateFilter) return false;
    if (groupFilter !== "all" && r.group !== groupFilter) return false;
    if (term && !`${r.label} ${r.detail || ""}`.toLowerCase().includes(term)) return false;
    return true;
  });

  const filtered = stateFilter !== "all" || groupFilter !== "all" || Boolean(term);
  const resetFilters = () => {
    setStateFilter("all");
    setGroupFilter("all");
    setQ("");
  };

  // How long the run took at its worst. A `skipped` check has no ms at all,
  // so this is over the ones that actually went out on the wire.
  const timings = all.map((r) => r.ms).filter((m): m is number => typeof m === "number");
  const slowest = timings.length ? Math.max(...timings) : null;

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

      {/* The numbers, and the filter, as one control: a tile says how many
          and selects them. Two separate things would be a count you then
          have to go and find. */}
      {results && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {STATE_ORDER.map((s) => (
              <Tile
                key={s}
                state={s}
                count={stateCounts[s]}
                active={stateFilter === s}
                onClick={() => setStateFilter((p) => (p === s ? "all" : s))}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Area</span>
            <button
              type="button"
              onClick={() => setGroupFilter("all")}
              className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                groupFilter === "all"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              All <span className="font-normal opacity-60">{all.length}</span>
            </button>
            {ORDER.map((g) => {
              const n = all.filter((r) => r.group === g).length;
              if (n === 0) return null;
              const bad = all.filter((r) => r.group === g && r.state === "down").length;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupFilter((p) => (p === g ? "all" : g))}
                  title={GROUP_BLURB[g]}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                    groupFilter === g
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  {GROUP_LABEL[g]} <span className="font-normal opacity-60">{n}</span>
                  {bad > 0 && (
                    <span className={groupFilter === g ? "ml-1 text-rose-100" : "ml-1 text-rose-600 dark:text-rose-400"}>
                      · {bad}
                    </span>
                  )}
                </button>
              );
            })}

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a check…"
              className="h-8 w-40 rounded-lg border border-gray-200 px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />

            <span className="ml-auto flex items-center gap-3 text-[11px] text-gray-400">
              <span>
                Showing {visible.length} of {all.length}
                {slowest != null && ` · slowest ${slowest.toLocaleString("en-IN")} ms`}
              </span>
              {filtered && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="font-semibold text-gray-500 hover:underline dark:text-gray-400"
                >
                  Reset
                </button>
              )}
            </span>
          </div>
        </div>
      )}

      {results && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 px-5 py-10 text-center dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">No check matches those filters</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-gray-500 dark:text-gray-400">
            {stateFilter === "down"
              ? "Nothing is failing — which is the answer you wanted."
              : "The run finished; these filters just hide all of it."}{" "}
            <button type="button" onClick={resetFilters} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
              Show everything
            </button>
          </p>
        </div>
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
          // Filtered rows, not all of them — a section header must describe
          // what is actually underneath it, or filtering to OK leaves a
          // header claiming three problems above two healthy rows.
          const rows = visible.filter((r) => r.group === group);
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
