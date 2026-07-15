"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";

/**
 * Lands here after the user clicks an invite or password-reset email link.
 * Supabase passes tokens in the URL hash (#access_token=...&type=invite).
 * We set the session and prompt for a password if this is a fresh invite,
 * then send the user to the dashboard.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const t = useTranslations("AuthCallback");
  const supabase = createClient();
  const [status, setStatus] = useState<"loading" | "set_password" | "error">("loading");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<string>("");

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const linkType = params.get("type") || "";
    setType(linkType);

    if (!accessToken || !refreshToken) {
      setError(t("invalidLink"));
      setStatus("error");
      return;
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionErr }) => {
        if (sessionErr) {
          setError(sessionErr.message);
          setStatus("error");
          return;
        }
        // Invites and password recoveries need the user to set a password
        if (linkType === "invite" || linkType === "recovery" || linkType === "signup") {
          setStatus("set_password");
        } else {
          router.push("/dashboard");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError(t("passwordTooShort")); return; }
    if (password !== confirmPassword) { setError(t("passwordsMismatch")); return; }
    setSaving(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updErr) { setError(updErr.message); return; }
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 px-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-6">
          <img src="/logo.svg" alt="RecentGossips" className="h-9 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {status === "set_password"
              ? type === "recovery"
                ? t("resetTitle")
                : t("welcomeTitle")
              : status === "error"
                ? t("errorTitle")
                : t("verifyingTitle")}
          </h1>
          {status === "set_password" && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("choosePassword")}</p>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {status === "loading" && (
          <div className="flex justify-center py-6">
            <svg className="w-6 h-6 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {status === "set_password" && (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("newPasswordLabel")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="At least 8 characters"
                className="w-full px-4 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Re-enter the password"
                className="w-full px-4 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 disabled:opacity-50 text-white font-medium transition-all cursor-pointer"
            >
              {saving ? "Saving..." : "Set password and continue"}
            </button>
          </form>
        )}

        {status === "error" && (
          <button
            onClick={() => router.push("/login")}
            className="w-full py-2.5 px-4 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer"
          >
            Back to login
          </button>
        )}
      </div>
    </div>
  );
}
