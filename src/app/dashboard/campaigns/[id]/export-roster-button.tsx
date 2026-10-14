"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { getCampaignRosterForExport } from "./export-actions";
import { ROSTER_EXPORT_COLUMNS } from "./export-columns";

const APPLICATION_STATUSES = new Set([
  "pending", "approved", "submitted", "revision_needed", "accepted",
  "live_submitted", "payment", "completed", "rejected", "withdrawn",
]);

// Windows forbids \ / : * ? " < > | in filenames; also keep it short.
function safeFileName(title: string) {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").slice(0, 60);
  return base || "campaign";
}

/**
 * Downloads everyone on the campaign — applicants and sourced creators —
 * as one sheet.
 *
 * Sits under the slots line because that is the number it explains: the
 * file carries a Source and a Holds Seat column, so filtering Holds Seat
 * to Yes gives back exactly the figure on screen.
 */
export function ExportRosterButton({ campaignId }: { campaignId: string }) {
  const t = useTranslations("DashboardCampaignsIdApplications");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await getCampaignRosterForExport(campaignId);
      if (result.error || !result.rows) {
        alert(result.error || t("exportFailed"));
        return;
      }

      const header = ROSTER_EXPORT_COLUMNS.map((c) => c.header);
      const body = result.rows.map((row) =>
        ROSTER_EXPORT_COLUMNS.map((c) => {
          const v = row[c.key];
          // A sourced creator has no application status, so an empty cell
          // must stay empty rather than be looked up and render as a key.
          if (c.key === "status" && typeof v === "string" && APPLICATION_STATUSES.has(v)) return t(`status.${v}`);
          if (c.key === "plan" && typeof v === "string" && v) return v.charAt(0).toUpperCase() + v.slice(1);
          return v ?? "";
        }),
      );

      // Loaded on demand — the library is large and only needed on click.
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      ws["!cols"] = ROSTER_EXPORT_COLUMNS.map((c) => ({ wch: c.width }));
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Roster");

      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${safeFileName(result.campaignTitle || "")}_roster_${date}.xlsx`);
    } catch {
      alert(t("exportFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      aria-busy={loading}
      title={t("downloadRosterTitle")}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
    >
      {loading ? (
        <ButtonSpinner />
      ) : (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )}
      {loading ? t("exporting") : t("downloadRoster")}
    </button>
  );
}
