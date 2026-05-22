"use client";

import { useState, useTransition } from "react";
import { deliverFinalFiles } from "../actions";

type FileRow = { name: string; size: string; url: string };

const blankRow: FileRow = { name: "", size: "", url: "" };

export function DeliverFinalForm({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<FileRow[]>([{ ...blankRow }]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const setField = (i: number, key: keyof FileRow, val: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { ...blankRow }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const onSubmit = () => {
    setError("");
    const clean = rows
      .map((r) => ({ name: r.name.trim(), size: r.size.trim(), url: r.url.trim() }))
      .filter((r) => r.name && r.url);
    if (clean.length === 0) {
      setError("Add at least one file (name + URL).");
      return;
    }
    const formData = new FormData();
    formData.set("final_files_json", JSON.stringify(clean));
    startTransition(async () => {
      const res = await deliverFinalFiles(orderId, formData);
      if (res?.error) setError(res.error);
      else setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Deliver final files</h3>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">
            Final payment received. Upload your files (Drive / Dropbox / your CDN) and paste the links — the order closes when you submit.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
        >
          Deliver final files
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Final files</h3>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">
          One row per file. Size is optional — used only for display.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input
              value={row.name}
              onChange={(e) => setField(i, "name", e.target.value)}
              placeholder="File name (e.g. Aesthetic_Reel_Final_4K.mp4)"
              className="col-span-12 sm:col-span-5 input"
            />
            <input
              value={row.size}
              onChange={(e) => setField(i, "size", e.target.value)}
              placeholder="Size"
              className="col-span-4 sm:col-span-2 input"
            />
            <input
              value={row.url}
              onChange={(e) => setField(i, "url", e.target.value)}
              placeholder="https://…"
              className="col-span-7 sm:col-span-4 input"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length === 1}
              className="col-span-1 sm:col-span-1 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-rose-500 disabled:opacity-30 cursor-pointer"
              aria-label="Remove row"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="text-[12px] font-semibold text-emerald-600 hover:underline cursor-pointer"
      >
        + Add another file
      </button>

      {error && <p className="text-[12px] text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending}
          className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Mark completed & notify user"}
        </button>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgb(229 231 235);
          background: white;
          font-size: 12px;
          outline: none;
        }
        .input:focus {
          border-color: rgb(16 185 129);
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
        }
        .dark .input {
          background: rgb(17 24 39);
          border-color: rgb(55 65 81);
          color: rgb(229 231 235);
        }
      `}</style>
    </div>
  );
}
