"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { removeAdmin, resendAdminInvite, updateAdminRole, setAdminPassword } from "./actions";
import { ButtonSpinner } from "@/components/spinner";
import { ConfirmDialog, useConfirmDialog } from "@/components/confirm-dialog";

interface Admin {
  id: string;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
}

export function AdminRow({
  admin,
  isSuperAdmin,
  isCurrentUser,
  lastSignInAt,
  emailConfirmedAt,
  pendingSetup,
}: {
  admin: Admin;
  isSuperAdmin: boolean;
  isCurrentUser: boolean;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  pendingSetup: boolean;
}) {
  const t = useTranslations("DashboardAdminsAdminRow");
  const [removing, setRemoving] = useState(false);
  const [resending, setResending] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [role, setRole] = useState(admin.role);
  const confirmRevoke = useConfirmDialog();

  // Super-admin "set password" modal state.
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState(false);

  const handleSetPassword = async () => {
    setPwError("");
    setPwSaving(true);
    const res = await setAdminPassword(admin.id, newPw);
    setPwSaving(false);
    if (res.error) {
      setPwError(res.error);
      return;
    }
    setPwDone(true);
    setNewPw("");
  };

  const roleColors: Record<string, string> = {
    super_admin: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400",
    admin: "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400",
    viewer: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
  };

  const roleLabels: Record<string, string> = {
    super_admin: t("roles.superAdmin"),
    admin: t("roles.admin"),
    viewer: t("roles.viewer"),
  };

  // Acceptance status. `pending_setup` (set at invite, cleared when the
  // password is actually chosen) is authoritative — clicking the invite link
  // signs the user in and sets last_sign_in_at BEFORE they pick a password,
  // so last_sign_in_at alone would flip them to "active" too early.
  //   active   = setup finished (flag cleared, and they've signed in)
  //   verified = link opened but password not set yet (still pending_setup)
  //   pending  = invited, link not opened
  const accepted = !pendingSetup && !!lastSignInAt;
  const openedButIncomplete = pendingSetup && (!!lastSignInAt || !!emailConfirmedAt);
  const status: "active" | "verified" | "pending" = accepted
    ? "active"
    : openedButIncomplete
      ? "verified"
      : "pending";

  const statusBadge =
    status === "active"
      ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
      : status === "verified"
        ? "bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400"
        : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400";

  const statusLabel =
    status === "active" ? t("status.active") : status === "verified" ? t("status.linkVerified") : t("status.pendingInvite");

  const handleRevoke = () => {
    const isPending = status === "pending";
    confirmRevoke.ask({
      title: isPending
        ? t("revoke.cancelTitle", { name: admin.full_name })
        : t("revoke.revokeTitle", { name: admin.full_name }),
      description: isPending
        ? t("revoke.cancelDescription")
        : t("revoke.revokeDescription"),
      confirmLabel: isPending ? t("revoke.cancelConfirm") : t("revoke.revokeConfirm"),
      cancelLabel: t("revoke.keep"),
      variant: "danger",
      handler: async () => {
        setRemoving(true);
        try {
          const result = await removeAdmin(admin.id);
          if (result.error) alert(result.error);
        } finally {
          setRemoving(false);
        }
      },
    });
  };

  const handleResend = async () => {
    setResending(true);
    const result = await resendAdminInvite(admin.id);
    if (result.error) alert(result.error);
    else alert(t("resendSuccess"));
    setResending(false);
  };

  const handleRoleChange = async (next: string) => {
    if (next === role) return;
    const prev = role;
    setRole(next);
    setRoleSaving(true);
    const result = await updateAdminRole(admin.id, next);
    setRoleSaving(false);
    if (result.error) {
      // Roll back the select if the action rejected the change.
      setRole(prev);
      alert(result.error);
    }
  };

  return (
    <>
      <ConfirmDialog {...confirmRevoke.dialogProps} />

      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("setPasswordTitle", { name: admin.full_name })}
              </h3>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">{t("setPasswordSubtitle")}</p>
            </div>
            <div className="p-5 space-y-3">
              {pwDone ? (
                <p className="text-[13px] text-emerald-600 dark:text-emerald-400 font-semibold">✓ {t("setPasswordDone")}</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoFocus
                    autoComplete="new-password"
                    placeholder={t("setPasswordPlaceholder")}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                  <p className="text-[11px] text-gray-400">{t("setPasswordHint")}</p>
                  {pwError && <p className="text-[12px] text-red-600">{pwError}</p>}
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => setPwOpen(false)}
                disabled={pwSaving}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-700 dark:text-gray-200 cursor-pointer disabled:opacity-50"
              >
                {pwDone ? t("close") : t("cancel")}
              </button>
              {!pwDone && (
                <button
                  onClick={handleSetPassword}
                  disabled={pwSaving || newPw.trim().length < 8}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pwSaving && <ButtonSpinner />}
                  {pwSaving ? t("saving") : t("setPasswordConfirm")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
        {admin.full_name}
        {isCurrentUser && (
          <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{t("you")}</span>
        )}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{admin.email}</td>
      <td className="px-6 py-4">
        {isSuperAdmin && !isCurrentUser ? (
          <div className="inline-flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              disabled={roleSaving || removing || resending}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:opacity-60 ${
                roleColors[role] || roleColors.viewer
              }`}
            >
              <option value="super_admin">{t("roles.superAdmin")}</option>
              <option value="admin">{t("roles.admin")}</option>
              <option value="viewer">{t("roles.viewer")}</option>
            </select>
            {roleSaving && <ButtonSpinner />}
          </div>
        ) : (
          <span
            className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
              roleColors[role] || roleColors.viewer
            }`}
          >
            {roleLabels[role] || role}
          </span>
        )}
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            status === "active" ? "bg-emerald-500" : status === "verified" ? "bg-cyan-500" : "bg-amber-500 animate-pulse"
          }`} />
          {statusLabel}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
        {new Date(admin.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
      </td>
      {isSuperAdmin && (
        <td className="px-6 py-4">
          {!isCurrentUser && (
            <div className="flex items-center gap-2">
              {/* Pending → Resend; Active → no resend (they don't need one) */}
              {status !== "active" && (
                <button
                  onClick={handleResend}
                  disabled={resending || removing}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resending ? <ButtonSpinner /> : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                  {resending ? t("sending") : t("resendInvite")}
                </button>
              )}
              <button
                onClick={() => {
                  setNewPw("");
                  setPwError("");
                  setPwDone(false);
                  setPwOpen(true);
                }}
                disabled={removing || resending}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                {t("setPassword")}
              </button>
              <button
                onClick={handleRevoke}
                disabled={removing || resending}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {removing ? <ButtonSpinner /> : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
                {removing ? t("removing") : status === "pending" ? t("cancelInvite") : t("revokeAccess")}
              </button>
            </div>
          )}
        </td>
      )}
      </tr>
    </>
  );
}
