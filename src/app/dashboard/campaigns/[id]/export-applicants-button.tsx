"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { getCampaignApplicantsForExport } from "./export-actions";
import { APPLICANT_EXPORT_COLUMNS } from "./export-columns";

const APPLICATION_STATUSES = new Set([
  "pending", "approved", "submitted", "revision_needed", "accepted",
  "live_submitted", "payment", "completed", "rejected", "withdrawn",
]);

// Windows forbids \ / : * ? " < > | in filenames; also keep it short.
function safeFileName(title: string) {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").slice(0, 60);
  return base || "campaign";
}

export function ExportApplicantsButton({ campaignId }: { campaignId: string }) {
  const t = useTranslations("DashboardCampaignsIdApplications");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await getCampaignApplicantsForExport(campaignId);
      if (result.error || !result.rows) {
        alert(result.error || t("exportFailed"));
        return;
      }

      const header = APPLICANT_EXPORT_COLUMNS.map((c) => c.header);
      const body = result.rows.map((row) =>
        APPLICANT_EXPORT_COLUMNS.map((c) => {
          const v = row[c.key];
          if (c.key === "status" && typeof v === "string" && APPLICATION_STATUSES.has(v)) return t(`status.${v}`);
          if (c.key === "plan" && typeof v === "string" && v) return v.charAt(0).toUpperCase() + v.slice(1);
          return v ?? "";
        }),
      );

      // Loaded on demand — the library is large and only needed on click.
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      ws["!cols"] = APPLICANT_EXPORT_COLUMNS.map((c) => ({ wch: c.width }));
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Applicants");

      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${safeFileName(result.campaignTitle || "")}_applicants_${date}.xlsx`);
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
      title={t("downloadExcelTitle")}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
    >
      {loading ? (
        <ButtonSpinner />
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )}
      {loading ? t("exporting") : t("downloadExcel")}
    </button>
  );
}
