"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // "danger" = red confirm button (destructive actions like Revoke/Delete)
  // "primary" = indigo confirm button
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  // Disable the buttons while the confirmed action is running
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "primary",
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const t = useTranslations("ConfirmDialog");
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-500 disabled:bg-red-300"
      : "bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300";

  const iconBg =
    variant === "danger"
      ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
      : "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400";

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="fixed z-50 inset-2 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start gap-3.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>
            )}
          </div>
        </div>

        <div className="px-6 pb-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer disabled:opacity-50"
          >
            {cancelLabel ?? t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold cursor-pointer transition-colors disabled:cursor-not-allowed ${confirmClass}`}
          >
            {busy && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {busy ? t("working") : (confirmLabel ?? t("confirm"))}
          </button>
        </div>
      </div>
    </>
  );
}

// Convenience hook for the common "click a button → show a confirm
// dialog → run an async handler" pattern. Returns the dialog props plus
// an `ask()` function that fires the dialog with a custom handler.
export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "primary";
    handler: () => Promise<void> | void;
  } | null>(null);

  const ask = (cfg: NonNullable<typeof config>) => {
    setConfig(cfg);
    setOpen(true);
  };

  const cancel = () => {
    if (busy) return;
    setOpen(false);
    setConfig(null);
  };

  const confirm = async () => {
    if (!config) return;
    setBusy(true);
    try {
      await config.handler();
    } finally {
      setBusy(false);
      setOpen(false);
      setConfig(null);
    }
  };

  return {
    ask,
    dialogProps: {
      open,
      busy,
      title: config?.title || "",
      description: config?.description,
      confirmLabel: config?.confirmLabel,
      cancelLabel: config?.cancelLabel,
      variant: config?.variant,
      onConfirm: confirm,
      onCancel: cancel,
    } satisfies ConfirmDialogProps,
  };
}
