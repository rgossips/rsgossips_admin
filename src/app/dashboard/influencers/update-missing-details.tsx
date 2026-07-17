"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { scanMissingPhotos, enrichInvitationPhotos } from "./enrich-actions";
import { ENRICH_CHUNK_SIZE, type MissingPhotoRow, type EnrichOutcome } from "./enrich-constants";

type Phase = "idle" | "scanning" | "listed" | "updating" | "done";

export function UpdateMissingDetails() {
  const t = useTranslations("DashboardInfluencersUpdateMissingDetails");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<MissingPhotoRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [done, setDone] = useState(0);
  const [outcomes, setOutcomes] = useState<EnrichOutcome[]>([]);
  const [error, setError] = useState("");

  const openAndScan = async () => {
    setOpen(true);
    setPhase("scanning");
    setError("");
    setOutcomes([]);
    setDone(0);
    const res = await scanMissingPhotos();
    if (res.error) {
      setError(res.error);
      setPhase("idle");
      return;
    }
    setRows(res.rows || []);
    setTruncated(!!res.truncated);
    setPhase("listed");
  };

  const runUpdate = async () => {
    setPhase("updating");
    setError("");
    const collected: EnrichOutcome[] = [];

    // Walk the work-list in chunks so no single request outlives the
    // platform's function timeout. A failed chunk is recorded and the run
    // continues — one bad handle must not strand the remaining rows.
    for (let i = 0; i < rows.length; i += ENRICH_CHUNK_SIZE) {
      const slice = rows.slice(i, i + ENRICH_CHUNK_SIZE);
      const res = await enrichInvitationPhotos(slice.map((r) => r.id));

      if (res.error) {
        // A key/limit failure applies to every remaining chunk too — stop
        // rather than replaying the same error N more times.
        setError(res.error);
        break;
      }
      collected.push(...(res.results || []));
      setDone(Math.min(i + slice.length, rows.length));
      setOutcomes([...collected]);
    }

    setPhase("done");
  };

  const close = () => {
    setOpen(false);
    setPhase("idle");
    setRows([]);
    setOutcomes([]);
    setError("");
    setDone(0);
  };

  const okCount = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o) => !o.ok);

  return (
    <>
      <button
        onClick={openAndScan}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {t("button")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("title")}</h3>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">{t("subtitle")}</p>
            </div>

            <div className="p-5 space-y-3 max-h-[55vh] overflow-y-auto">
              {phase === "scanning" && (
                <p className="text-[13px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <ButtonSpinner /> {t("scanning")}
                </p>
              )}

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[12px] text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              {phase === "listed" && rows.length === 0 && !error && (
                <p className="text-[13px] text-gray-500 dark:text-gray-400">{t("noneMissing")}</p>
              )}

              {phase === "listed" && rows.length > 0 && (
                <>
                  <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">
                    {t("foundCount", { count: rows.length })}
                  </p>
                  {truncated && (
                    <p className="text-[11px] text-amber-600">{t("truncated")}</p>
                  )}
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg">
                    {rows.map((r) => (
                      <li key={r.id} className="px-3 py-2 flex items-center justify-between gap-3">
                        <span className="text-[13px] text-gray-700 dark:text-gray-200 truncate">
                          {r.full_name || t("unnamed")}
                        </span>
                        <span className="text-[11px] font-mono text-gray-400 shrink-0">
                          @{r.instagram_username}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {(phase === "updating" || phase === "done") && (
                <>
                  <p className="text-[13px] text-gray-700 dark:text-gray-200 flex items-center gap-2">
                    {phase === "updating" && <ButtonSpinner />}
                    {phase === "updating"
                      ? t("updatingProgress", { done, total: rows.length })
                      : t("finished", { ok: okCount, failed: failed.length })}
                  </p>
                  {phase === "done" && failed.length > 0 && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-1">
                        {t("notUpdated")}
                      </p>
                      <ul className="space-y-0.5">
                        {failed.map((f) => (
                          <li key={f.id} className="text-[11px] text-amber-800 dark:text-amber-300">
                            <span className="font-mono">@{f.username}</span> — {f.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={close}
                disabled={phase === "updating"}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-700 dark:text-gray-200 cursor-pointer disabled:opacity-50"
              >
                {phase === "done" ? t("close") : t("cancel")}
              </button>
              {phase === "listed" && rows.length > 0 && (
                <button
                  onClick={runUpdate}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold cursor-pointer"
                >
                  {t("updateCount", { count: rows.length })}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
