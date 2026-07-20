"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import { useRole } from "@/components/role-context";

type NavSpec = { label: string; href: string; icon: string; badgeKey?: string };
// `titleKey` maps to Sidebar.groups.* in the message catalog; `title` is the
// English fallback used until a group is added to the catalog.
type NavGroup = { title?: string; titleKey?: string; items: NavSpec[] };

// Sidebar navigation, grouped so influencer- and brand-related items
// no longer sit side-by-side with each other and with operations.
// Ordering per group is "primary entity → its featured/curated surfaces".
const navGroups: NavGroup[] = [
  {
    // Top strip — everything cross-cutting sits under a "Overview" heading
    // rather than crowding the influencer/brand groups below.
    title: "Overview",
    titleKey: "overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "grid" },
    ],
  },
  {
    title: "Influencers",
    titleKey: "influencers",
    items: [
      { label: "Influencers", href: "/dashboard/influencers", icon: "users" },
      { label: "Featured Creators", href: "/dashboard/featured-creators", icon: "star" },
      { label: "Creator Stories", href: "/dashboard/creator-stories", icon: "video" },
      { label: "Refer & Earn", href: "/dashboard/referrals", icon: "sparkles", badgeKey: "referralReviews" },
    ],
  },
  {
    title: "Brands",
    titleKey: "brands",
    items: [
      { label: "Brands", href: "/dashboard/brands", icon: "briefcase" },
      { label: "Featured Brands", href: "/dashboard/featured-brands", icon: "tag" },
      { label: "Campaigns", href: "/dashboard/campaigns", icon: "megaphone" },
      { label: "Featured Campaigns", href: "/dashboard/featured-campaigns", icon: "flame" },
    ],
  },
  {
    title: "Operations",
    titleKey: "operations",
    items: [
      { label: "Disputes", href: "/dashboard/disputes", icon: "scale", badgeKey: "openDisputes" },
      { label: "Payouts", href: "/dashboard/payouts", icon: "wallet", badgeKey: "pendingPayouts" },
      { label: "Services", href: "/dashboard/services", icon: "sparkles" },
      { label: "Quote Requests", href: "/dashboard/quote-requests", icon: "inbox", badgeKey: "pendingQuotes" },
      { label: "Leads", href: "/dashboard/leads", icon: "phone" },
    ],
  },
];

const adminNav: NavSpec[] = [
  { label: "Admin Users", href: "/dashboard/admins", icon: "shield" },
  { label: "AI Settings", href: "/dashboard/ai-settings", icon: "sparkles" },
  { label: "AI Usage", href: "/dashboard/ai-usage", icon: "chart" },
  { label: "Load Test", href: "/dashboard/load-test", icon: "grid" },
];

const icons: Record<string, React.ReactNode> = {
  grid: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  users: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  briefcase: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
    </svg>
  ),
  megaphone: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    </svg>
  ),
  shield: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  sparkles: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L23 12l-6.714 2.143L14 21l-2.286-6.857L5 12l6.714-2.143L14 3z" />
    </svg>
  ),
  inbox: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-5l-2 2h-2l-2-2H4" />
    </svg>
  ),
  phone: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  star: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  ),
  video: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  flame: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.24 17 7.317c1.07 2.043.282 4.622-1.5 6.183a7 7 0 002.157 5.157z" />
    </svg>
  ),
  tag: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  scale: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
    </svg>
  ),
  wallet: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2H3V8zm0 4h18v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6zm14 3a1 1 0 100 2 1 1 0 000-2z" />
    </svg>
  ),
  chart: (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3v18h18M8 17V9m5 8V5m5 12v-6" />
    </svg>
  ),
};

function NavItem({
  item,
  isActive,
  badge,
}: {
  item: { label: string; href: string; icon: string; badgeKey?: string };
  isActive: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
        isActive
          ? "bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-900/40"
          : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800/60"
      }`}
    >
      <span className={isActive ? "text-white" : "text-gray-400 dark:text-gray-500"}>
        {icons[item.icon]}
      </span>
      <span className="flex-1">{item.label}</span>
      {badge != null && badge > 0 && (
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            isActive ? "bg-white/20 text-white" : "bg-rose-500 text-white"
          }`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  userEmail,
  userName: userNameProp,
  collapsed,
  onClose,
}: {
  userEmail: string;
  // Display name from admin_profiles.full_name. Falls back to the
  // email-derived label when the row doesn't have one yet (older invites).
  userName?: string;
  collapsed?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isSuperAdmin, role } = useRole();
  const t = useTranslations("Sidebar");

  // Live counts used by nav badges. Currently just the inbox of pending
  // quote requests; refresh every 30 s so admins see new submissions
  // without a full reload.
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const fetchBadges = async () => {
      try {
        const supabase = createClient();
        const [quoteRes, disputeRes, payoutRes, reviewRes] = await Promise.all([
          supabase
            .from("service_orders")
            .select("*", { count: "exact", head: true })
            .in("status", ["pending_quote", "counter_offered"]),
          supabase
            .from("escrow_disputes_v")
            .select("*", { count: "exact", head: true })
            .eq("escrow_status", "disputed"),
          supabase
            .from("campaign_applications")
            .select("*", { count: "exact", head: true })
            .in("payout_status", ["scheduled", "pending_creator_info"]),
          supabase
            .from("referrals")
            .select("*", { count: "exact", head: true })
            .eq("status", "MANUAL_REVIEW"),
        ]);
        if (!cancelled) {
          setBadges((prev) => ({
            ...prev,
            pendingQuotes: quoteRes.count ?? 0,
            openDisputes: disputeRes.count ?? 0,
            pendingPayouts: payoutRes.count ?? 0,
            referralReviews: reviewRes.count ?? 0,
          }));
        }
      } catch {
        // Non-fatal — leave previous count in place.
      }
    };
    fetchBadges();
    const t = setInterval(fetchBadges, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  const userName = userNameProp?.trim() || userEmail.split("@")[0].replace(/[._-]/g, " ");
  const initials = userName
    .split(" ")
    .map((p) => p[0]?.toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <>
      {/* Mobile overlay */}
      {collapsed === false && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-screen w-[260px] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col z-50 transition-transform duration-300 lg:translate-x-0 ${
          collapsed === false ? "translate-x-0" : collapsed ? "-translate-x-full" : ""
        }`}
      >
        {/* Logo */}
        <div className="h-16 px-5 flex items-center gap-2 border-b border-gray-100 dark:border-gray-800">
          <img src="/logo.svg" alt="RecentGossips" className="h-7 dark:brightness-125" />
          <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">ADMIN</span>
        </div>

        {/* User profile card */}
        <div className="px-4 pt-5 pb-2">
          <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center ring-2 ring-white dark:ring-gray-800 shadow-sm">
              <span className="text-xs font-bold text-white">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize truncate">{userName}</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 capitalize">
                {role === "super_admin" ? "Super Admin" : role === "admin" ? "Admin" : role === "viewer" ? "Viewer (read-only)" : "Administrator"}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 pt-4 overflow-y-auto">
          {navGroups.map((group, gi) => (
            <div key={group.title || `group-${gi}`} className={gi > 0 ? "mt-5" : ""}>
              {group.title && (
                <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600">
                  {group.titleKey ? t(`groups.${group.titleKey}`) : group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem
                    key={item.href}
                    item={item}
                    isActive={isActive(item.href)}
                    badge={item.badgeKey ? badges[item.badgeKey] : undefined}
                  />
                ))}
              </div>
            </div>
          ))}

          {isSuperAdmin && (
            <div className="mt-5">
              <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600">
                {t("groups.adminPanel")}
              </p>
              <div className="space-y-0.5">
                {adminNav.map((item) => (
                  <NavItem key={item.href} item={item} isActive={isActive(item.href)} />
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all duration-200 cursor-pointer"
          >
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
