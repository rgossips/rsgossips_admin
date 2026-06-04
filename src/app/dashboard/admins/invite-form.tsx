"use client";

import { useState } from "react";
import { inviteAdmin } from "./actions";
import { ButtonSpinner, FullPageLoader } from "@/components/spinner";

export function InviteForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  const handleSubmit = async (formData: FormData) => {
    setError("");
    setSuccess("");
    setLoading(true);

    // Best-effort progress copy — the server action runs all steps in
    // one call so we step the message client-side to indicate progress.
    setLoadingMsg("Preparing invitation…");
    const ticks = setInterval(() => {
      setLoadingMsg((prev) => {
        if (prev === "Preparing invitation…") return "Generating secure link…";
        if (prev === "Generating secure link…") return "Sending email…";
        return prev;
      });
    }, 900);

    const result = await inviteAdmin(formData);
    clearInterval(ticks);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess("Invite sent successfully!");
      setOpen(false);
    }
    setLoading(false);
    setLoadingMsg("");
  };

  return (
    <div className="mb-6">
      {loading && <FullPageLoader message={loadingMsg || "Sending invitation…"} />}
      {success && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 text-sm mb-4">
          {success}
        </div>
      )}

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors cursor-pointer"
        >
          Invite Admin
        </button>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            Invite New Admin
          </h3>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          <form action={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
                <input name="full_name" type="text" required placeholder="John Doe" className="w-full px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input name="email" type="email" required placeholder="user@example.com" className="w-full px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                <select name="role" className="w-full px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer">
                {loading && <ButtonSpinner />}
                {loading ? "Sending..." : "Send Invite"}
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(""); }} className="px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors cursor-pointer">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
