"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCampaign } from "../actions";
import { ButtonSpinner, FullPageLoader } from "@/components/spinner";

// Permanently removes a campaign and everything hanging off it. This is
// unrecoverable and takes real money/work history with it (applications,
// deliverables, payments, chats, ratings), so it requires typing the
// campaign title to confirm — same bar as the user-deletion flow.
export function DeleteCampaignButton({
  campaignId,
  title,
  applicationCount,
}: {
  campaignId: string;
  title: string;
  applicationCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const confirmWord = (title || "").trim() || "DELETE";
  const canDelete = typed.trim().toLowerCase() === confirmWord.toLowerCase();

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError("");
    const res = await deleteCampaign(campaignId);
    if (res.error) {
      setError(res.error);
      setDeleting(false);
      return;
    }
    // Row is gone — go back to the list rather than re-rendering a 404.
    router.push("/dashboard/campaigns");
    router.refresh();
  };

  return (
    <>
      {deleting && <FullPageLoader message="Deleting campaign and all its data…" />}

      <button
        onClick={() => {
          setOpen(true);
          setTyped("");
          setError("");
        }}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Delete this campaign?</h3>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">
                This permanently removes the campaign and <strong>all of its progress</strong> —{" "}
                {applicationCount > 0
                  ? `${applicationCount} application${applicationCount === 1 ? "" : "s"}, plus their`
                  : "any"}{" "}
                deliverables, payments, chat history, ratings and reviews. This cannot be undone.
              </p>
            </div>

            <div className="p-5 space-y-3">
              <label className="block text-[12px] text-gray-600 dark:text-gray-300">
                Type <span className="font-semibold text-gray-900 dark:text-white">{confirmWord}</span> to confirm
              </label>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-red-400"
              />
              {error && <p className="text-[12px] text-red-600">{error}</p>}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-700 dark:text-gray-200 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!canDelete || deleting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting && <ButtonSpinner />}
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
