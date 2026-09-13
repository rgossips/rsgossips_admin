"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useConfirmDialog } from "@/components/confirm-dialog";
import { deleteOldErrorLogs } from "./actions";
import { ERROR_RETENTION_DAYS } from "./constants";

// "Delete errors older than 30 days". The page passes how many rows qualify
// so the button can say so up front and disable itself when there's nothing
// to delete.
export function DeleteOldErrorsButton({ oldCount }: { oldCount: number }) {
  const router = useRouter();
  const confirm = useConfirmDialog();
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const onClick = () => {
    setResult(null);
    confirm.ask({
      title: `Delete ${oldCount.toLocaleString("en-IN")} error${oldCount === 1 ? "" : "s"}?`,
      description: `Every error logged more than ${ERROR_RETENTION_DAYS} days ago will be permanently removed, whether open or addressed. This can't be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
      handler: async () => {
        const res = await deleteOldErrorLogs();
        if (res.error) {
          setResult({ kind: "error", text: res.error });
          return;
        }
        const n = res.deleted ?? 0;
        setResult({ kind: "ok", text: `Deleted ${n.toLocaleString("en-IN")} old error${n === 1 ? "" : "s"}.` });
        router.refresh();
      },
    });
  };

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span role="status" className={`text-[12px] ${result.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {result.text}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={oldCount === 0}
        title={oldCount === 0 ? `No errors older than ${ERROR_RETENTION_DAYS} days` : undefined}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-[13px] font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-gray-900 dark:text-rose-400 dark:hover:bg-rose-950/40 cursor-pointer"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete &gt; {ERROR_RETENTION_DAYS} days old{oldCount > 0 ? ` (${oldCount.toLocaleString("en-IN")})` : ""}
      </button>
      <ConfirmDialog {...confirm.dialogProps} />
    </div>
  );
}
