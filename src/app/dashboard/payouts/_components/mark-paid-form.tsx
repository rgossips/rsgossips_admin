"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { markPayoutPaid } from "../actions";

// Inline "Mark as paid" form. Collapsed by default — admin clicks the
// button, fills UTR + date + method, clicks Save. Calls the server action
// and reloads the page on success so the row drops out of the queue.

const METHODS = [
  { value: "upi", label: "UPI" },
  { value: "imps", label: "IMPS" },
  { value: "neft", label: "NEFT" },
  { value: "rtgs", label: "RTGS" },
] as const;

export function MarkPaidForm({
  applicationId,
  defaultMethod,
  canWrite,
}: {
  applicationId: string;
  defaultMethod?: "upi" | "imps" | "neft" | "rtgs" | null;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [utr, setUtr] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [method, setMethod] = useState<"upi" | "imps" | "neft" | "rtgs">(
    defaultMethod || "imps",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const t = useTranslations("DashboardPayoutsComponentsMarkPaidForm");

  if (!canWrite) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold cursor-pointer"
      >
        {t("markAsPaid")}
      </button>
    );
  }

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await markPayoutPaid(applicationId, utr, paidAt || null, method);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setUtr("");
      setPaidAt("");
    });
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2 min-w-[280px]">
      <div className="flex items-center gap-2">
        <input
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          maxLength={50}
          placeholder={t("utrPlaceholder")}
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500"
          autoFocus
        />
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as any)}
          className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-[12px] font-semibold"
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-[10px] text-gray-400">{t("leaveBlankNow")}</span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !utr.trim()}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold disabled:opacity-50 cursor-pointer"
        >
          {saving ? t("saving") : t("confirmPaid")}
        </button>
      </div>
      {error && <p className="text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
