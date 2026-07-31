"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRole } from "@/components/role-context";
import { useOpsBadges, type OpsBadges } from "@/hooks/use-ops-badges";

// App-like bottom navigation for phones (lg:hidden). Surfaces the critical
// decision queues one tap away, with live counts from the shared hook. Heavy
// routes stay in the drawer (hamburger). Desktop never renders this.
type Item = {
  href: string;
  labelKey: string;
  badgeKey?: keyof OpsBadges;
  icon: React.ReactNode;
};

const ICON = "w-5 h-5";

const ITEMS: Item[] = [
  {
    href: "/dashboard",
    labelKey: "overview",
    icon: (
      <svg className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM13 6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V6zM4 15a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3zM13 15a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/disputes",
    labelKey: "disputes",
    badgeKey: "openDisputes",
    icon: (
      <svg className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v18M3 7l9-4 9 4M5 7l-2 5a4 4 0 008 0L9 7M19 7l-2 5a4 4 0 008 0l-2-5" />
      </svg>
    ),
  },
  {
    href: "/dashboard/payouts",
    labelKey: "payouts",
    badgeKey: "pendingPayouts",
    icon: (
      <svg className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2H3V8zm0 4h18v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6zm14 3a1 1 0 100 2 1 1 0 000-2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/quote-requests",
    labelKey: "quotes",
    badgeKey: "pendingQuotes",
    icon: (
      <svg className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/referrals",
    labelKey: "referrals",
    badgeKey: "referralReviews",
    icon: (
      <svg className={ICON} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-6.714 2.143L12 21l-2.286-6.857L3 12l6.714-2.143L12 3z" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("MobileNav");
  const { isViewer } = useRole();
  const badges = useOpsBadges();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 pb-[env(safe-area-inset-bottom)]">
      <ul className="flex items-stretch justify-around">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          // Viewers can't act on the queues, but they can still monitor, so we
          // keep the tabs and just hide the count nudge for them.
          const count = !isViewer && item.badgeKey ? badges[item.badgeKey] : 0;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors ${
                  active
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <span className="relative">
                  {item.icon}
                  {count > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
