"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// A dismissible "this screen works best on desktop" hint, shown only on phones
// (lg:hidden) at the top of heavy/form-intensive pages. Nothing is blocked —
// the admin can still act in a pinch. Dismissal is remembered in localStorage
// so it doesn't nag on every visit.
const KEY = "rg_desktop_best_dismissed";

export function DesktopBestBanner() {
  const t = useTranslations("DesktopBestBanner");
  // Start hidden so SSR and first client paint match (no hydration flash); we
  // reveal after reading localStorage on the client.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== "1") setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="lg:hidden mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3.5 py-2.5">
      <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <p className="flex-1 text-[12px] text-amber-800 dark:text-amber-300">{t("message")}</p>
      <button
        onClick={dismiss}
        aria-label={t("dismiss")}
        className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
