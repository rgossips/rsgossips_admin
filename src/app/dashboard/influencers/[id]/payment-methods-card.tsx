"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { revealPaymentMethods } from "./payment-actions";
import type { PaymentMethodRow } from "./payment-methods";

// Module scope, not nested in the component that owns state — a
// subcomponent redefined on every render remounts its children.
const STATUS_TONE: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  manual: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 text-[13px] text-gray-800 dark:text-gray-200 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

export function PaymentMethodsCard({
  influencerId,
  methods: initial,
}: {
  influencerId: string;
  /** Already masked on the server — no secret is in this payload. */
  methods: PaymentMethodRow[];
}) {
  const t = useTranslations("DashboardInfluencersId");
  const [methods, setMethods] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    const res = await revealPaymentMethods(influencerId);
    setBusy(false);
    if (res.error || !res.methods) {
      setError(res.error || t("payouts.revealFailed"));
      return;
    }
    setMethods(res.methods);
    setRevealed(true);
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("payouts.title")}</h2>
        {methods.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
            {methods.length}
          </span>
        )}
        {methods.length > 0 && !revealed && (
          <button
            type="button"
            onClick={() => void reveal()}
            disabled={busy}
            aria-busy={busy}
            title={t("payouts.revealHint")}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {busy && <ButtonSpinner />}
            {busy ? t("payouts.revealing") : t("payouts.reveal")}
          </button>
        )}
        {revealed && <span className="ml-auto text-[11px] text-gray-400">{t("payouts.revealedNote")}</span>}
      </div>

      {error && <p className="px-6 pt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {methods.length === 0 ? (
        // Worth stating rather than leaving the card out: "no payout method"
        // is the reason a creator cannot be paid, and an absent card reads
        // as "we did not look".
        <p className="px-6 py-10 text-center text-sm text-gray-400 dark:text-gray-500">{t("payouts.empty")}</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {methods.map((m) => {
            const isUpi = String(m.type || "").toLowerCase() === "upi";
            const status = String(m.validation_status || "").toLowerCase();
            return (
              <div key={m.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {isUpi ? t("payouts.upi") : t("payouts.bank")}
                  </span>
                  {m.is_primary && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      {t("payouts.primary")}
                    </span>
                  )}
                  {status && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[status] || STATUS_TONE.pending}`}
                      title={m.validation_failure_reason || undefined}
                    >
                      {status}
                    </span>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {isUpi ? (
                    <Field label={t("payouts.upiId")} value={m.upi_id || "—"} mono />
                  ) : (
                    <>
                      <Field label={t("payouts.accountNumber")} value={m.account_number || "—"} mono />
                      <Field label={t("payouts.ifsc")} value={m.ifsc || "—"} mono />
                      <Field label={t("payouts.bankName")} value={m.bank_name || "—"} />
                    </>
                  )}
                  {m.account_holder_name && (
                    <Field label={t("payouts.holder")} value={m.account_holder_name} />
                  )}
                </div>

                {/* The reason an automatic verification did not happen. Shown
                    in full because it is what tells an admin whether to pay
                    out by hand or chase the creator for a correction. */}
                {m.validation_failure_reason && (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">{m.validation_failure_reason}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
