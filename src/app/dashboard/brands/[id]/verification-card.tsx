"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatStatus } from "@/lib/format";
import { BrandVerificationActions, type VerificationVerdict } from "../brand-verification-actions";

const STATUS_TONE: Record<string, string> = {
  verified: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400",
  pending: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
};

/**
 * Verification, on the brand's own page.
 *
 * Until now the verdict could only be given from the brands LIST — so an
 * admin who opened a brand to decide whether it was genuine (which is the
 * page that actually shows the GSTIN, the website, the contact and the
 * campaigns) had to go back to the list to act on what they had just read.
 *
 * The buttons are the shared BrandVerificationActions, not a third copy:
 * the action behind them notifies the brand and every notification insert
 * pushes to their phone.
 *
 * `router.refresh()` after a verdict is what keeps the header badge honest —
 * it is rendered by the server component above this one, so without the
 * refresh the page would show "pending" in the header and "verified" here.
 */
export function BrandVerificationCard({
  brandId,
  initialStatus,
}: {
  brandId: string;
  initialStatus: string | null;
}) {
  const t = useTranslations("DashboardBrandsId");
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);

  const onChange = (next: VerificationVerdict) => {
    setStatus(next);
    router.refresh();
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t("verification")}</h3>
        <span
          className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
            STATUS_TONE[status || "pending"] || STATUS_TONE.pending
          }`}
        >
          {formatStatus(status, "Pending")}
        </span>
      </div>

      {/* What the verdict actually does, because it is not obvious from the
          word: brand-campaigns refuses to publish for a brand that is not
          verified, so a pending brand is blocked and waiting on us. */}
      <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
        {status === "verified" ? t("verifyHelpVerified") : t("verifyHelpPending")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <BrandVerificationActions
          brandId={brandId}
          status={status}
          onChange={onChange}
          size="md"
          showIcons
        />
      </div>

      <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">{t("verifyNotifyNote")}</p>
    </div>
  );
}
