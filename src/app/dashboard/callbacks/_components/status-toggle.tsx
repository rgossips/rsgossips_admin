"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { setCallbackStatus } from "../actions";

// "Mark done" / "Reopen" toggle for a support callback row. Hidden for
// viewers (read-only role) — same pattern as MarkPaidForm on Payouts.
export function StatusToggle({
  id,
  status,
  canWrite,
}: {
  id: string;
  status: string;
  canWrite: boolean;
}) {
  const t = useTranslations("DashboardCallbacksComponentsStatusToggle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canWrite) return null;

  const isOpen = status === "open";
  const next = isOpen ? "done" : "open";

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const res = await setCallbackStatus(id, next);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-50 cursor-pointer transition-colors ${
          isOpen
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        }`}
      >
        {pending && <ButtonSpinner />}
        {isOpen ? t("markDone") : t("reopen")}
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
