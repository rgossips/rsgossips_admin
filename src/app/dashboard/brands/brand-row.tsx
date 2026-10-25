"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatStatus } from "@/lib/format";
import { BrandVerificationActions } from "./brand-verification-actions";
import { useRole } from "@/components/role-context";
import { BrandTypeBadge } from "@/components/brand-type-badge";
import { toBrandAccountType } from "@/lib/brand-account-type";
import { ListCard } from "@/components/mobile/list-card";
import { PlatformBadges } from "@/components/platform-badges";
import type { Platform } from "@/lib/device-platforms";

interface Brand {
  brand_id: string;
  brand_name: string | null;
  logo_url: string | null;
  contact_phone: string | null;
  verification_status: string | null;
  gstin: string | null;
  account_type?: string | null;
}

// One component, two shapes — only the markup branches. The verification
// buttons themselves live in BrandVerificationActions, which the brand detail
// page mounts too; this row keeps the STATUS because it also renders the badge
// (a table cell here, a card badge below), and the badge and the buttons must
// not be able to disagree about what state the brand is in.
export function BrandRow({ brand, variant = "row", platforms }: { brand: Brand; variant?: "row" | "card"; platforms?: Platform[] }) {
  const router = useRouter();
  const { isAdmin } = useRole();
  const [verificationStatus, setVerificationStatus] = useState(brand.verification_status);

  const statusColors: Record<string, string> = {
    verified: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
    rejected: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400",
    pending: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
  };

  const logo = brand.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logo_url} alt="" className="w-9 h-9 rounded-full object-cover" />
  ) : (
    <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 text-xs">
      {brand.brand_name?.[0] || "?"}
    </div>
  );

  const verificationBadge = (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColors[verificationStatus || "pending"] || statusColors.pending}`}>
      {formatStatus(verificationStatus, "Pending")}
    </span>
  );

  if (variant === "card") {
    return (
      <ListCard
        leading={logo}
        title={
          <Link href={`/dashboard/brands/${brand.brand_id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
            {brand.brand_name || "—"}
          </Link>
        }
        subtitle={brand.contact_phone || undefined}
        badges={
          <>
            {verificationBadge}
            <BrandTypeBadge kind="profile" id={brand.brand_id} value={toBrandAccountType(brand.account_type)} />
          </>
        }
        facts={[
          ...(brand.gstin ? [{ label: "GSTIN", value: <span className="font-mono text-[12px]">{brand.gstin}</span> }] : []),
          { label: "Platform", value: <PlatformBadges platforms={platforms} emptyLabel="Never signed in" /> },
        ]}
        // Literally the same control as the desktop row, not a reduced set:
        // verifying a brand is the whole reason an admin opens this on a phone.
        actions={
          isAdmin ? (
            <BrandVerificationActions
              brandId={brand.brand_id}
              status={verificationStatus}
              onChange={setVerificationStatus}
            />
          ) : undefined
        }
      />
    );
  }

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
          <BrandTypeBadge kind="profile" id={brand.brand_id} value={toBrandAccountType(brand.account_type)} />
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
          {formatStatus(verificationStatus, "Pending")}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 font-mono text-xs">
        {brand.gstin || "—"}
      </td>
      <td className="px-6 py-4">
        <PlatformBadges platforms={platforms} emptyLabel="Never signed in" />
      </td>
      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
        {!isAdmin ? (
          <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
        ) : (
          <div className="flex items-center gap-2">
            <BrandVerificationActions
              brandId={brand.brand_id}
              status={verificationStatus}
              onChange={setVerificationStatus}
              showIcons
            />
          </div>
        )}
      </td>
    </tr>
  );
}
