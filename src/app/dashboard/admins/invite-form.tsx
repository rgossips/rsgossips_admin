"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { inviteAdmin } from "./actions";
import { ButtonSpinner, FullPageLoader } from "@/components/spinner";

export function InviteForm() {
  const t = useTranslations("DashboardAdminsInviteForm");
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
    setLoadingMsg(t("progress.preparing"));
    const ticks = setInterval(() => {
      setLoadingMsg((prev) => {
        if (prev === t("progress.preparing")) return t("progress.generatingLink");
        if (prev === t("progress.generatingLink")) return t("progress.sendingEmail");
        return prev;
      });
    }, 900);

    const result = await inviteAdmin(formData);
    clearInterval(ticks);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(t("successMessage"));
      setOpen(false);
    }
    setLoading(false);
    setLoadingMsg("");
  };

  return (
    <div className="mb-6">
      {loading && <FullPageLoader message={loadingMsg || t("progress.sendingInvitation")} />}
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
          {t("inviteAdmin")}
        </button>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            {t("inviteNewAdmin")}
          </h3>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          {/* onSubmit (not action=) so setLoading is an urgent update that
              paints the loader immediately — a React 19 form action runs in a
              transition, which can skip the loader paint for a fast invite. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit(new FormData(e.currentTarget));
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("fullNameLabel")}</label>
                <input name="full_name" type="text" required placeholder={t("fullNamePlaceholder")} className="w-full px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("emailLabel")}</label>
                <input name="email" type="email" required placeholder={t("emailPlaceholder")} className="w-full px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("roleLabel")}</label>
                <select name="role" className="w-full px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                  <option value="admin">{t("roleAdmin")}</option>
                  <option value="viewer">{t("roleViewer")}</option>
                  <option value="super_admin">{t("roleSuperAdmin")}</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer">
                {loading && <ButtonSpinner />}
                {loading ? t("sending") : t("sendInvite")}
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(""); }} className="px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors cursor-pointer">
                {t("cancel")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
