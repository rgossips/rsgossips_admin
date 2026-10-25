"use client";

import { useState } from "react";
import { ButtonSpinner } from "@/components/spinner";
import { getInfluencersForExport } from "./export-actions";
import {
  DEFAULT_EXPORT_KEYS,
  INFLUENCER_EXPORT_COLUMNS,
  SENSITIVE_EXPORT_KEYS,
} from "./export-columns";
import type { InfluencerFilters } from "@/lib/influencer-filters";

// Windows forbids \ / : * ? " < > | in filenames; also keep it short.
function safeFileName(base: string) {
  return base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").slice(0, 60) || "influencers";
}

/**
 * Download the creator list as Excel.
 *
 * Two choices before it runs, because both have been got wrong by exports
 * that offered neither: WHICH creators, and WHICH columns.
 *
 * On scope, the dialog offers the filters already applied to the page
 * rather than a second set of filter controls. The page's filters are in
 * the URL and already produce exactly the list on screen, so "the ones I
 * am looking at" is the predictable option; a duplicate filter UI in a
 * modal is one more thing that can disagree with the page behind it. The
 * active filters are spelled out so the choice is not a guess.
 */
export function ExportInfluencersButton({
  filters,
  filterSummary,
  matching,
  totalAll,
}: {
  filters: InfluencerFilters;
  /** Human-readable active filters, from describeFilters(). */
  filterSummary: string[];
  /** How many match those filters right now. */
  matching: number;
  /** How many creators there are in total. */
  totalAll: number;
}) {
  const [open, setOpen] = useState(false);
  const [useFilters, setUseFilters] = useState(true);
  const [keys, setKeys] = useState<string[]>(DEFAULT_EXPORT_KEYS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const hasFilters = filterSummary.length > 0;
  const toggle = (k: string) =>
    setKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  const includesSensitive = keys.some((k) => SENSITIVE_EXPORT_KEYS.includes(k));

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await getInfluencersForExport(useFilters && hasFilters ? filters : {}, keys);
      if (res.error || !res.rows) {
        setNote(res.error || "Could not build the export.");
        return;
      }
      if (res.rows.length === 0) {
        setNote("Nothing matches those filters.");
        return;
      }

      // Ordered by the catalogue, not by the order they were ticked, so two
      // people exporting the same columns get the same sheet.
      const chosen = INFLUENCER_EXPORT_COLUMNS.filter((c) => keys.includes(c.key));
      const header = chosen.map((c) => c.header);
      const body = res.rows.map((row) => chosen.map((c) => row[c.key] ?? ""));

      // Loaded on demand — the library is large and only needed on click.
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      ws["!cols"] = chosen.map((c) => ({ wch: c.width }));
      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }),
      };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Influencers");

      const date = new Date().toISOString().slice(0, 10);
      const scope = useFilters && hasFilters ? "filtered" : "all";
      XLSX.writeFile(wb, `${safeFileName(`influencers_${scope}`)}_${date}.xlsx`);

      if (res.truncated) {
        setNote(`Capped at ${res.rows.length.toLocaleString()} rows — narrow the filters for the rest.`);
      } else {
        setOpen(false);
      }
    } catch {
      setNote("Could not build the export.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download list
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Download influencer list</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scope */}
        <fieldset className="mt-4">
          <legend className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Which creators</legend>
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-800 dark:text-gray-200">
              <input
                type="radio"
                name="scope"
                checked={useFilters && hasFilters}
                disabled={!hasFilters}
                onChange={() => setUseFilters(true)}
                className="mt-0.5 cursor-pointer disabled:cursor-not-allowed"
              />
              <span>
                <span className="font-semibold">The ones on screen</span>{" "}
                <span className="text-gray-500 dark:text-gray-400">({matching.toLocaleString()})</span>
                {hasFilters ? (
                  <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                    {filterSummary.join(" · ")}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    No filters are applied, so this is the same as everyone.
                  </span>
                )}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-800 dark:text-gray-200">
              <input
                type="radio"
                name="scope"
                checked={!useFilters || !hasFilters}
                onChange={() => setUseFilters(false)}
                className="mt-0.5 cursor-pointer"
              />
              <span>
                <span className="font-semibold">Every registered creator</span>{" "}
                <span className="text-gray-500 dark:text-gray-400">({totalAll.toLocaleString()})</span>
              </span>
            </label>
          </div>
          {/* Changing the filters means changing them on the page. Said out
              loud, because a dialog that silently ignores a filter you set
              is worse than one that tells you where filters live. */}
          <p className="mt-2 text-[11px] text-gray-400">
            To change what is included, close this and adjust the filters on the page.
          </p>
        </fieldset>

        {/* Columns */}
        <fieldset className="mt-5">
          <div className="flex items-center justify-between">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Columns</legend>
            <div className="flex gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setKeys(INFLUENCER_EXPORT_COLUMNS.map((c) => c.key))}
                className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setKeys(DEFAULT_EXPORT_KEYS)}
                className="font-semibold text-gray-500 hover:underline dark:text-gray-400"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {INFLUENCER_EXPORT_COLUMNS.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-1.5 text-[12px] text-gray-700 dark:text-gray-300"
              >
                <input
                  type="checkbox"
                  checked={keys.includes(c.key)}
                  onChange={() => toggle(c.key)}
                  className="h-3.5 w-3.5 cursor-pointer"
                />
                {c.header}
                {c.sensitive && <span className="text-[9px] font-bold uppercase text-amber-600">pii</span>}
              </label>
            ))}
          </div>
        </fieldset>

        {includesSensitive && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            This file will contain personal contact details. The download is recorded against your account.
          </p>
        )}

        {note && <p className="mt-3 text-[12px] text-rose-600 dark:text-rose-400">{note}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || keys.length === 0}
            aria-busy={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
          >
            {busy && <ButtonSpinner />}
            {busy ? "Building…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
