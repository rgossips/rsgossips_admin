"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useOpsBadges, type OpsBadges } from "@/hooks/use-ops-badges";

// Mobile-only (lg:hidden) "needs attention" hub shown at the top of the
// dashboard home. Large tap-targets for the live decision queues, each with a
// count from the shared hook. On desktop the full sidebar + overview take over,
// so this never renders there.
type Card = {
  href: string;
  key: keyof OpsBadges;
  labelKey: string;
  tone: string; // pill/emphasis color when count > 0
  icon: React.ReactNode;
};

const CARDS: Card[] = [
  {
    href: "/dashboard/disputes",
    key: "openDisputes",
    labelKey: "disputes",
    tone: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v18M3 7l9-4 9 4M5 7l-2 5a4 4 0 008 0L9 7M19 7l-2 5a4 4 0 008 0l-2-5" />
      </svg>
    ),
  },
  {
    href: "/dashboard/payouts",
    key: "pendingPayouts",
    labelKey: "payouts",
    tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2H3V8zm0 4h18v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6zm14 3a1 1 0 100 2 1 1 0 000-2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/quote-requests",
    key: "pendingQuotes",
    labelKey: "quotes",
    tone: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/referrals",
    key: "referralReviews",
    labelKey: "referrals",
    tone: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-6.714 2.143L12 21l-2.286-6.857L3 12l6.714-2.143L12 3z" />
      </svg>
    ),
  },
];

export function MobileOpsHub() {
  const t = useTranslations("MobileOps");
  const badges = useOpsBadges();
  const total = CARDS.reduce((sum, c) => sum + (badges[c.key] || 0), 0);

  return (
    <div className="lg:hidden">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">{t("heading")}</h2>
      {total === 0 && (
        <p className="mb-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
          {t("allClear")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {CARDS.map((c) => {
          const count = badges[c.key] || 0;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="flex flex-col gap-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 min-h-[92px] active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className={`inline-flex w-9 h-9 items-center justify-center rounded-xl ${c.tone}`}>{c.icon}</span>
                {count > 0 && (
                  <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </div>
              <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{t(c.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
