"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { sendQuote, declineOrder } from "../actions";

type Props = {
  orderId: string;
  serviceTitle: string;
  desiredDeliveryDate?: string | null;
};

// Default a delivery date a week out so the admin has a sensible starting
// point — they can change it.
function defaultDeliveryISO(desired?: string | null) {
  if (desired) return desired;
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function QuoteResponseForm({ orderId, serviceTitle, desiredDeliveryDate }: Props) {
  const t = useTranslations("DashboardQuoteRequestsComponentsQuoteResponseForm");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"none" | "quote" | "decline">("none");

  // No platform fee — the user pays exactly what we quote.
  const [amount, setAmount] = useState("");
  const total = amount ? Number(amount) : 0;

  const onSend = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const res = await sendQuote(orderId, formData);
      if (res?.error) setError(res.error);
    });
  };
  const onDecline = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const res = await declineOrder(orderId, formData);
      if (res?.error) setError(res.error);
    });
  };

  if (mode === "none") {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("respondHeading")}</h3>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          {t("respondDescription")}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setMode("quote")}
            className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer"
          >
            {t("sendQuote")}
          </button>
          <button
            onClick={() => setMode("decline")}
            className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
          >
            {t("decline")}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "decline") {
    return (
      <form
        action={onDecline}
        className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800 rounded-xl p-5 space-y-3"
      >
        <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">{t("declineHeading")}</h3>
        <textarea
          name="decline_reason"
          rows={3}
          placeholder={t("declineReasonPlaceholder")}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
        />
        {error && <p className="text-[12px] text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("none")}
            disabled={pending}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
          >
            {pending ? t("declining") : t("declineRequest")}
          </button>
        </div>
      </form>
    );
  }

  // mode === "quote"
  return (
    <form
      action={onSend}
      className="bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5 space-y-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("sendQuoteHeading", { serviceTitle })}</h3>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">
          {t("noPlatformFeeNote")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldL label={t("quotedAmountLabel")} required>
          <input
            name="quoted_amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            type="text"
            inputMode="numeric"
            required
            className="input"
            placeholder="3600"
          />
        </FieldL>
        <FieldL label={t("advancePctLabel")} hint={t("advancePctHint")}>
          <input
            name="advance_pct"
            defaultValue="50"
            type="number"
            min={0}
            max={100}
            className="input"
          />
        </FieldL>
        <FieldL label={t("quotedDeliveryDateLabel")} required>
          <input
            name="quoted_delivery_date"
            defaultValue={defaultDeliveryISO(desiredDeliveryDate)}
            type="date"
            required
            className="input"
          />
        </FieldL>
        <FieldL label={t("turnaroundDaysLabel")} hint={t("turnaroundDaysHint")}>
          <input name="quoted_turnaround_days" defaultValue="4" type="number" min={1} className="input" />
        </FieldL>
        <FieldL label={t("revisionsAllowedLabel")}>
          <input name="revisions_allowed" defaultValue="2" type="number" min={0} max={10} className="input" />
        </FieldL>
        <FieldL label={t("quoteValidityDaysLabel")} hint={t("quoteValidityDaysHint")}>
          <input name="quote_validity_days" defaultValue="7" type="number" min={1} max={60} className="input" />
        </FieldL>
        <FieldL label={t("finalFormatsLabel")} hint={t("finalFormatsHint")}>
          <input
            name="final_formats"
            defaultValue="4K + 1080p"
            type="text"
            className="input"
            placeholder="4K + 1080p"
          />
        </FieldL>
      </div>

      <div>
        <label className="block text-[12px] font-semibold text-gray-700 dark:text-gray-200 mb-1">
          {t("teamNoteLabel")}
        </label>
        <textarea
          name="quote_message"
          rows={3}
          placeholder={t("teamNotePlaceholder")}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* Live total preview */}
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg p-3 text-[12px]">
        <Row
          label={t("totalUserPaysLabel")}
          value={amount ? `₹${total.toLocaleString("en-IN")}` : "—"}
          bold
        />
      </div>

      {error && <p className="text-[12px] text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("none")}
          disabled={pending}
          className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer disabled:opacity-50"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
        >
          {pending ? t("sending") : t("sendQuote")}
        </button>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgb(229 231 235);
          background: white;
          font-size: 13px;
          outline: none;
        }
        .input:focus {
          border-color: rgb(99 102 241);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
        .dark .input {
          background: rgb(17 24 39);
          border-color: rgb(55 65 81);
          color: rgb(229 231 235);
        }
      `}</style>
    </form>
  );
}

function FieldL({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-200 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? "font-bold text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
