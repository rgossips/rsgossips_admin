"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BRAND_ACCOUNT_TYPES, BRAND_TYPE_PARAM, isBrandAccountType, type BrandAccountType } from "@/lib/brand-account-type";

const LABEL: Record<BrandAccountType, string> = { brand: "Brands", agency: "Agencies" };

// "Brands / Agencies" checkboxes, kept in the `btype` URL param so the server
// page filters and the view is shareable. Used on the Brands and Campaigns lists.
export function BrandTypeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const picked = new Set((searchParams.get(BRAND_TYPE_PARAM) || "").split(",").filter(isBrandAccountType));

  const toggle = (t: BrandAccountType) => {
    const next = new Set(picked);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    const params = new URLSearchParams(searchParams.toString());
    if (next.size) params.set(BRAND_TYPE_PARAM, BRAND_ACCOUNT_TYPES.filter((x) => next.has(x)).join(","));
    else params.delete(BRAND_TYPE_PARAM);
    // A new filter is a new result set — back to page 1.
    for (const key of [...params.keys()]) if (key === "page" || key.endsWith("_page")) params.delete(key);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex items-center gap-3" role="group" aria-label="Brand type">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Type</span>
      {BRAND_ACCOUNT_TYPES.map((t) => (
        <label key={t} className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={picked.has(t)}
            onChange={() => toggle(t)}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
          />
          {LABEL[t]}
        </label>
      ))}
    </div>
  );
}
