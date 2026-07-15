"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateBrandVerification } from "./actions";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { useRole } from "@/components/role-context";

interface Brand {
  brand_id: string;
  brand_name: string | null;
  logo_url: string | null;
  contact_phone: string | null;
  verification_status: string | null;
  gstin: string | null;
}

export function BrandRow({ brand }: { brand: Brand }) {
  const t = useTranslations("DashboardBrandsBrandRow");
  const router = useRouter();
  const { isAdmin } = useRole();
  const [loading, setLoading] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState(brand.verification_status);

  const handleVerification = async (action: "verified" | "rejected" | "pending") => {
    setLoading(action);
    const result = await updateBrandVerification(brand.brand_id, action);
    if (result.error) {
      alert(result.error);
    } else {
      setVerificationStatus(action);
    }
    setLoading(null);
  };

  const statusColors: Record<string, string> = {
    verified: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
    rejected: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400",
    pending: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
  };

  const actionBtnBase =
    "inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border";

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/brands/${brand.brand_id}`)}>
      <td className="px-6 py-4">
        <div className="flex items-center gap-3 group">
          {brand.logo_url ? (
            <img src={brand.logo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 text-xs">
              {brand.brand_name?.[0] || "?"}
            </div>
          )}
          <span className="text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
            {brand.brand_name || "—"}
          </span>
        </div>
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        {brand.contact_phone || "—"}
      </td>
      <td className="px-6 py-4">
        <span
          className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
            statusColors[verificationStatus || "pending"] || statusColors.pending
          }`}
        >
          {verificationStatus || "pending"}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 font-mono text-xs">
        {brand.gstin || "—"}
      </td>
      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
        {!isAdmin ? (
          <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
        ) : verificationStatus === "pending" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleVerification("verified")}
              disabled={loading !== null}
              className={`${actionBtnBase} bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40`}
            >
              {loading === "verified" ? <ButtonSpinner /> : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {loading === "verified" ? "..." : t("verify")}
            </button>
            <button
              onClick={() => handleVerification("rejected")}
              disabled={loading !== null}
              className={`${actionBtnBase} bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40`}
            >
              {loading === "rejected" ? <ButtonSpinner /> : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {loading === "rejected" ? "..." : t("reject")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => handleVerification("pending")}
            disabled={loading !== null}
            className={`${actionBtnBase} bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700`}
          >
            {loading ? <ButtonSpinner /> : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {loading ? "..." : t("reset")}
          </button>
        )}
      </td>
    </tr>
  );
}
