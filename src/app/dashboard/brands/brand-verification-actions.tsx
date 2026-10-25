"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { updateBrandVerification } from "./actions";

export type VerificationVerdict = "verified" | "rejected" | "pending";

/**
 * The Verify / Reject / Reset control, in one place.
 *
 * WHY IT IS SHARED. It now has three mounts — the brands table row, the
 * brands card on phones, and the brand detail page — and each one calls a
 * server action that NOTIFIES the brand: `updateBrandVerification` pushes
 * `brand_verified` / `brand_verification_rejected`, and every notification
 * insert fans out to web push and FCM. Three copies of that call would be
 * three chances for one of them to get the verdict, the re-notify guard or
 * the disabled state subtly wrong, and the symptom would be a brand's phone
 * buzzing about a decision nobody made.
 *
 * It is CONTROLLED: the caller owns `status` and receives the new one via
 * `onChange`. That is deliberate — every mount also renders the status
 * somewhere of its own (a table cell, a card badge, a page header), and if
 * this component kept its own copy the badge and the buttons could disagree
 * about what the brand's state is. One value, passed down.
 */
export function BrandVerificationActions({
  brandId,
  status,
  onChange,
  size = "sm",
  showIcons = false,
}: {
  brandId: string;
  status: string | null;
  onChange: (next: VerificationVerdict) => void;
  /** "md" is the detail page, where this is the primary action on the page. */
  size?: "sm" | "md";
  showIcons?: boolean;
}) {
  const t = useTranslations("DashboardBrandsBrandRow");
  const [loading, setLoading] = useState<string | null>(null);

  const run = async (action: VerificationVerdict) => {
    setLoading(action);
    const result = await updateBrandVerification(brandId, action);
    if (result.error) alert(result.error);
    else onChange(action);
    setLoading(null);
  };

  const base = `inline-flex items-center gap-1.5 font-semibold rounded-lg border transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
    size === "md" ? "text-[13px] px-4 py-2.5" : "text-xs px-3.5 py-2"
  }`;

  if (status === "pending") {
    return (
      <>
        <button
          onClick={() => run("verified")}
          disabled={loading !== null}
          className={`${base} bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40`}
        >
          {loading === "verified" ? (
            <ButtonSpinner />
          ) : showIcons ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : null}
          {loading === "verified" ? "..." : t("verify")}
        </button>
        <button
          onClick={() => run("rejected")}
          disabled={loading !== null}
          className={`${base} bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40`}
        >
          {loading === "rejected" ? (
            <ButtonSpinner />
          ) : showIcons ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : null}
          {loading === "rejected" ? "..." : t("reject")}
        </button>
      </>
    );
  }

  return (
    <button
      onClick={() => run("pending")}
      disabled={loading !== null}
      className={`${base} bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700`}
    >
      {loading ? (
        <ButtonSpinner />
      ) : showIcons ? (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ) : null}
      {loading ? "..." : t("reset")}
    </button>
  );
}
