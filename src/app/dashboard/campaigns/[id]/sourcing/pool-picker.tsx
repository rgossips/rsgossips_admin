"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import { FULFILMENT_MODE_LABEL, type FulfilmentMode } from "@/lib/sourcing/stages";
import type { PoolCandidate } from "@/lib/sourcing/pool";
import { importFromPool, searchCreatorPool } from "./pool-actions";

// Pull creators out of our own database onto this campaign.
//
// The pool is both halves of the creator base: registered profiles AND
// pending invitations. An invited creator is a perfectly good person to DM —
// they are in the database because somebody already decided they were worth
// approaching — so hiding them would hide most of the pool.
//
// Candidates are RANKED, not filtered. A hard filter on every targeting
// field returns nobody on a brief asking for Beauty creators in Mumbai at
// 5–10k followers; a score surfaces the near misses and lets the admin
// judge. Why a creator ranked is printed on their row.

export function PoolPicker({ campaignId, defaultMode = "reimburse" }: { campaignId: string; defaultMode?: FulfilmentMode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<PoolCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Taken from the campaign's brief, not asked here — see the page. Each
  // booking can be switched afterwards from its own row.
  const mode = defaultMode;
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const keyOf = (c: PoolCandidate) => c.influencerId || c.invitationId || c.handle;

  const run = async () => {
    setLoading(true);
    setError("");
    setNote("");
    const res = await searchCreatorPool(campaignId, { search });
    setLoading(false);
    if (res.error) return setError(res.error);
    setCandidates(res.candidates || []);
    setPicked(new Set());
  };

  const toggle = (c: PoolCandidate) => {
    const k = keyOf(c);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const addPicked = async () => {
    if (!candidates) return;
    const chosen = candidates.filter((c) => picked.has(keyOf(c)) && !c.alreadySourced);
    if (chosen.length === 0) return;
    setImporting(true);
    setError("");
    const res = await importFromPool(
      campaignId,
      chosen.map((c) => ({
        influencerId: c.influencerId,
        invitationId: c.invitationId,
        handle: c.handle,
        name: c.name,
        followers: c.followers,
      })),
      mode,
    );
    setImporting(false);
    if (res.error) return setError(res.error);
    setNote(
      `${res.added} added to the sourcing list${res.skipped ? `, ${res.skipped} already there` : ""}.`,
    );
    setPicked(new Set());
    await run();
    router.refresh();
  };

  const available = (candidates || []).filter((c) => !c.alreadySourced && !c.alreadyApplied);
  const selectable = available.length;
  const allSelected = selectable > 0 && available.every((c) => picked.has(keyOf(c)));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!candidates) run();
        }}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 cursor-pointer"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        Find creators
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Creators from our database</h2>
          <p className="text-[12px] text-gray-500">
            Ranked against this campaign&apos;s brief. Invited creators are included — they&apos;re in here because
            someone already thought they were worth approaching.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-gray-500 hover:underline cursor-pointer">
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Filter by name or handle…"
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-gray-300 bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        />
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-gray-900 px-4 text-[13px] font-semibold text-white disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 cursor-pointer"
        >
          {loading && <ButtonSpinner />}
          Search
        </button>
      </div>

      {candidates && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
            <span className="text-[12px] text-gray-500">
              {candidates.length} found · {selectable} available · {picked.size} selected
              <span className="ml-2 text-gray-400">· {FULFILMENT_MODE_LABEL[mode].toLowerCase()}, editable per creator after</span>
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* One button that knows what it would do next, rather than a
                  Select all that strands you with no way back. */}
              <button
                type="button"
                onClick={() => setPicked(allSelected ? new Set() : new Set(available.map(keyOf)))}
                disabled={selectable === 0}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 cursor-pointer"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
              {picked.size > 0 && !allSelected && (
                <button
                  type="button"
                  onClick={() => setPicked(new Set())}
                  className="text-[12px] font-semibold text-gray-500 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={addPicked}
                disabled={importing || picked.size === 0}
                className="inline-flex h-8 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-[12px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {importing && <ButtonSpinner />}
                Add {picked.size || ""} to sourcing
              </button>
            </div>
          </div>

          {/* A grid, not a list: a creator row is short and the panel is the
              full width of the page, so a single column wasted most of it
              and meant scrolling past four names at a time. Whole card is
              the tap target — a 16px checkbox is a poor one on a phone. */}
          <ul className="mt-2 grid max-h-[460px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((c) => {
              const k = keyOf(c);
              const used = c.alreadySourced || c.alreadyApplied;
              const on = picked.has(k);
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => !used && toggle(c)}
                    disabled={used}
                    aria-pressed={on}
                    className={`flex h-full w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      used
                        ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-gray-900/40"
                        : on
                          ? "cursor-pointer border-indigo-400 bg-indigo-50/60 dark:border-indigo-600 dark:bg-indigo-900/20"
                          : "cursor-pointer border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/50"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-950"
                      }`}
                    >
                      {on && (
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-white">{c.name}</span>
                      {c.handle && <span className="block truncate text-[11px] text-gray-500">@{c.handle}</span>}
                      <span className="mt-1 block truncate text-[11px] text-gray-500">
                        {[
                          c.followers ? `${c.followers.toLocaleString("en-IN")} followers` : null,
                          c.location,
                        ].filter(Boolean).join(" · ")}
                      </span>
                      {c.categories.length > 0 && (
                        <span className="mt-0.5 block truncate text-[11px] text-gray-400">{c.categories.slice(0, 2).join(", ")}</span>
                      )}
                      {/* Why this person ranked, so the order is not a mystery. */}
                      {c.reasons.length > 0 && (
                        <span className="mt-1 block truncate text-[10px] text-indigo-600 dark:text-indigo-400">{c.reasons.join(" · ")}</span>
                      )}
                      {(!c.registered || used) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {!c.registered && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              invited only
                            </span>
                          )}
                          {c.alreadySourced && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800">
                              already sourced
                            </span>
                          )}
                          {c.alreadyApplied && (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              applied already
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
      {note && !error && <p className="mt-2 text-[12px] text-emerald-700 dark:text-emerald-400">{note}</p>}
    </div>
  );
}
