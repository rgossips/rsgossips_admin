"use client";

import { useState, useTransition } from "react";
import { deliverDraft } from "../actions";

type Props = {
  orderId: string;
  status: string;
  revisionsUsed: number;
  revisionsAllowed: number;
  currentDraftUrl?: string | null;
};

export function DeliverDraftForm({
  orderId,
  status,
  revisionsUsed,
  revisionsAllowed,
  currentDraftUrl,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const isResend = status === "revision_requested";
  const ctaLabel = isResend ? "Deliver revised draft" : "Deliver draft";
  const initialUrl = isResend ? currentDraftUrl || "" : "";

  const onSubmit = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const res = await deliverDraft(orderId, formData);
      if (res?.error) setError(res.error);
      else setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-violet-200 dark:border-violet-800 rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {isResend ? "Revision pending" : "Work in progress"}
          </h3>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">
            {isResend
              ? `User asked for a revision (${revisionsUsed}/${revisionsAllowed} used). Upload the new watermarked cut and deliver it back.`
              : "When the watermarked draft is ready, paste the preview URL to send it for review."}
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer"
        >
          {ctaLabel}
        </button>
      </div>
    );
  }

  return (
    <form
      action={onSubmit}
      className="bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5 space-y-3"
    >
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{ctaLabel}</h3>
      <div>
        <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Draft URL (watermarked) <span className="text-red-500">*</span>
        </label>
        <input
          name="draft_url"
          type="url"
          required
          defaultValue={initialUrl}
          placeholder="https://drive.google.com/… or https://vimeo.com/…"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <p className="text-[10px] text-gray-400 mt-1">
          Drive / Frame.io / Vimeo / YouTube unlisted — pick whatever lets the user preview without exposing the final file.
        </p>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-200 mb-1">
          Editor note (optional)
        </label>
        <textarea
          name="draft_note"
          rows={4}
          placeholder="Short context — what's in this cut, what you'd like the user to focus on…"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
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
          type="submit"
          disabled={pending}
          className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
        >
          {pending ? "Delivering…" : "Deliver draft"}
        </button>
      </div>
    </form>
  );
}
