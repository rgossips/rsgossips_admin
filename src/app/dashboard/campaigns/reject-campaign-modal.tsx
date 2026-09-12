"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { reviewCampaign } from "./actions";

export const MAX_REVIEW_REASON = 500;

// Shared reject-with-reason dialog for the campaign review queue.
//
// One component for both surfaces — the compact buttons on the campaigns
// table and the larger pair in the detail header — so the two can't drift on
// what they ask for or what they send. ConfirmDialog isn't reused here: it has
// no input slot, and the reason is the entire point of this dialog.
//
// The reason is optional. Rejecting spam shouldn't need a paragraph, but the
// field is front and centre because the brand only learns what to fix from
// what's typed here (it reaches them as a notification, and as a push).
// Mount this only while the dialog should be open ({rejecting && <… />}) —
// the same idiom the other modals here use. Mounting on demand is what keeps
// the reason box empty for each campaign, with no reset-on-open effect.
export function RejectCampaignModal({
  campaignId,
  onClose,
  onRejected,
}: {
  campaignId: string;
  onClose: () => void;
  onRejected: () => void;
}) {
  const t = useTranslations("DashboardCampaignsReject");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [busy, onClose]);

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await reviewCampaign(campaignId, "reject", reason);
    if (res.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
    onRejected();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div
        className="fixed z-50 inset-2 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{t("title")}</h2>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{t("description")}</p>
        </div>

        <div className="px-6 pb-2">
          <label htmlFor="reject-reason" className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {t("reasonLabel")}
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REVIEW_REASON))}
            disabled={busy}
            rows={4}
            autoFocus
            placeholder={t("reasonPlaceholder")}
            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 disabled:opacity-60 resize-none"
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[11px] text-gray-400">{t("reasonHint")}</span>
            <span className="text-[11px] text-gray-400 tabular-nums">
              {reason.length}/{MAX_REVIEW_REASON}
            </span>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-[13px]">
            {error}
          </div>
        )}

        <div className="px-6 py-4 flex gap-3 justify-end border-t border-gray-100 dark:border-gray-800 mt-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            onClick={submit}
            disabled={busy}
            aria-busy={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-red-300 disabled:cursor-wait text-white text-sm font-semibold cursor-pointer transition-colors"
          >
            {busy && <ButtonSpinner />}
            {busy ? t("sending") : t("confirm")}
          </button>
        </div>
      </div>
    </>
  );
}
