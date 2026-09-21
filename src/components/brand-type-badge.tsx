"use client";

import { useEffect, useRef, useState } from "react";
import { setBrandAccountType } from "@/app/dashboard/brands/actions";
import { BRAND_ACCOUNT_TYPES, type BrandAccountType } from "@/lib/brand-account-type";
import { useRole } from "@/components/role-context";

const STYLE: Record<BrandAccountType, string> = {
  brand: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800",
  agency: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800",
};
const LABEL: Record<BrandAccountType, string> = { brand: "Brand", agency: "Agency" };

// Brand / Agency badge. Admins click it to relabel; viewers just see it.
// Sits inside clickable rows/cards, so every click stops here instead of
// opening the brand.
export function BrandTypeBadge({
  kind,
  id,
  value,
}: {
  kind: "profile" | "invitation";
  id: string;
  value: BrandAccountType;
}) {
  const { isAdmin } = useRole();
  const [type, setType] = useState<BrandAccountType>(value);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = async (next: BrandAccountType) => {
    setOpen(false);
    if (next === type) return;
    const prev = type;
    setType(next);
    setSaving(true);
    setError("");
    const res = await setBrandAccountType(kind, id, next);
    setSaving(false);
    if (res.error) {
      setType(prev);
      setError(res.error);
    }
  };

  const badge = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STYLE[type]}`;

  if (!isAdmin) return <span className={badge}>{LABEL[type]}</span>;

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
        title={error || "Change: brand or agency"}
        className={`${badge} cursor-pointer disabled:cursor-wait disabled:opacity-60 ${error ? "ring-1 ring-rose-400" : ""}`}
      >
        {LABEL[type]}
        <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <span role="menu" className="absolute left-0 top-full z-20 mt-1 flex min-w-[110px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {BRAND_ACCOUNT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={t === type}
              onClick={() => pick(t)}
              className={`px-3 py-1.5 text-left text-xs font-semibold cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${t === type ? "text-indigo-600 dark:text-indigo-400" : "text-gray-700 dark:text-gray-200"}`}
            >
              {t === type ? "✓ " : ""}
              {LABEL[t]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
