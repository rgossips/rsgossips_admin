"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { addPayoutMethodForCreator, markPayoutMethodFailed } from "../actions";

// Recovery for a bounced transfer.
//
// A manual payout can fail because the creator mistyped their UPI or
// account number. Two things then need to happen, and neither was possible
// before: mark the saved details rejected so the creator can see why, and
// enter the corrected details support collected from them.
//
// Rejecting parks the payout back on `pending_creator_info`; adding details
// resumes it to `scheduled`. Both server actions handle that, so this form
// only collects input.

type Mode = null | "reject" | "add";

export function FixPayoutDetails({
  userId,
  paymentMethodId,
  canWrite,
}: {
  userId: string;
  paymentMethodId?: string | null;
  canWrite: boolean;
}) {
  const t = useTranslations("DashboardPayoutsComponentsFixPayoutDetails");
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // Reject
  const [reason, setReason] = useState("");

  // Add
  const [type, setType] = useState<"upi" | "bank">("upi");
  const [upiId, setUpiId] = useState("");
  const [holder, setHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");

  if (!canWrite) return null;

  const reset = () => {
    setMode(null);
    setError(null);
    setReason("");
    setUpiId("");
    setHolder("");
    setBankName("");
    setAccountNumber("");
    setIfsc("");
  };

  const submitReject = () => {
    if (!paymentMethodId) return;
    setError(null);
    startSave(async () => {
      const res = await markPayoutMethodFailed(paymentMethodId, reason);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDone(t("rejected"));
      reset();
    });
  };

  const submitAdd = () => {
    setError(null);
    startSave(async () => {
      const res = await addPayoutMethodForCreator({
        userId,
        type,
        upiId,
        accountHolderName: holder,
        bankName,
        accountNumber,
        ifsc,
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDone(
        res.resumed
          ? t("addedAndResumed", { count: res.resumed })
          : t("added"),
      );
      reset();
    });
  };

  const input =
    "w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500";

  if (mode === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {paymentMethodId && (
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setMode("reject");
            }}
            className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-400 text-[12px] font-semibold hover:bg-amber-50 dark:hover:bg-amber-950 cursor-pointer"
          >
            {t("markDetailsWrong")}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setMode("add");
          }}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        >
          {t("addDetails")}
        </button>
        {done && <span className="text-[11px] font-semibold text-emerald-600">{done}</span>}
      </div>
    );
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2 w-full lg:min-w-70">
      {mode === "reject" ? (
        <>
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            {t("rejectHint")}
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder={t("reasonPlaceholder")}
            className={input}
            autoFocus
          />
        </>
      ) : (
        <>
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            {t("addHint")}
          </p>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "upi" | "bank")}
            className={`${input} font-semibold`}
          >
            <option value="upi">{t("typeUpi")}</option>
            <option value="bank">{t("typeBank")}</option>
          </select>
          {type === "upi" ? (
            <>
              <input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                maxLength={50}
                placeholder={t("upiPlaceholder")}
                className={input}
                autoFocus
              />
              <input
                value={holder}
                onChange={(e) => setHolder(e.target.value)}
                maxLength={120}
                placeholder={t("holderOptionalPlaceholder")}
                className={input}
              />
            </>
          ) : (
            <>
              <input
                value={holder}
                onChange={(e) => setHolder(e.target.value)}
                maxLength={120}
                placeholder={t("holderPlaceholder")}
                className={input}
                autoFocus
              />
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                maxLength={18}
                inputMode="numeric"
                placeholder={t("accountPlaceholder")}
                className={input}
              />
              <div className="flex items-center gap-2">
                <input
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  maxLength={11}
                  placeholder={t("ifscPlaceholder")}
                  className={input}
                />
                <input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  maxLength={120}
                  placeholder={t("bankPlaceholder")}
                  className={input}
                />
              </div>
            </>
          )}
        </>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={mode === "reject" ? submitReject : submitAdd}
          disabled={saving || (mode === "reject" && !reason.trim())}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold disabled:opacity-50 cursor-pointer"
        >
          {saving ? t("saving") : mode === "reject" ? t("confirmReject") : t("confirmAdd")}
        </button>
      </div>
      {error && <p className="text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
