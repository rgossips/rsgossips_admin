"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";

interface Notification {
  id: string;
  type: "quote_request" | "submission" | "application";
  title: string;
  subtitle: string;
  href: string;
  time: string;
}

// Some source tables (campaign_applications) return timestamps WITHOUT a
// timezone — "2026-07-04T06:26:54.174", no Z, no offset — while others
// (service_orders) include "+00:00". Per the ES spec, a timezone-less ISO
// string is parsed as the VIEWER's local time, but every value in this stack
// is UTC wall-clock (Supabase's session TZ is UTC). Left as-is, an
// application notification is skewed by the viewer's offset (5.5h in IST),
// which is why a fresh one read as hours/days old. Normalise: if the string
// carries no timezone designator, treat it as UTC.
function parseTimestamp(iso: string): number {
  if (!iso) return NaN;
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
  // Space-separated form ("2026-07-04 06:26:54") also parses inconsistently
  // across engines — normalise the separator before appending the marker.
  const normalized = hasTz ? iso : iso.replace(" ", "T") + "Z";
  return new Date(normalized).getTime();
}

export function NotificationBell() {
  const t = useTranslations("NotificationBell");
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const load = async () => {
      try {
        // Awaiting-action items: pending quotes + counter offers + submitted applications + revision needed
        const [quotesRes, appsRes] = await Promise.all([
          supabase
            .from("service_orders")
            .select("id, order_number, service_title, status, created_at, updated_at")
            .in("status", ["pending_quote", "counter_offered", "revision_requested"])
            .order("updated_at", { ascending: false })
            .limit(10),
          supabase
            .from("campaign_applications")
            .select("id, status, campaign_id, created_at, updated_at, campaigns(title)")
            .in("status", ["submitted"])
            .order("updated_at", { ascending: false })
            .limit(10),
        ]);

        const items: Notification[] = [];

        for (const q of quotesRes.data || []) {
          const labelByStatus: Record<string, string> = {
            pending_quote: t("status.pending_quote"),
            counter_offered: t("status.counter_offered"),
            revision_requested: t("status.revision_requested"),
          };
          items.push({
            id: `quote-${q.id}`,
            type: "quote_request",
            title: labelByStatus[q.status as string] || q.status,
            subtitle: `${q.order_number} · ${q.service_title || ""}`,
            href: `/dashboard/quote-requests/${q.id}`,
            time: q.updated_at || q.created_at,
          });
        }

        for (const a of appsRes.data || []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const campaignTitle = (a as any).campaigns?.title || t("campaignFallback");
          items.push({
            id: `app-${a.id}`,
            type: "submission",
            title: t("deliverablesSubmitted"),
            subtitle: campaignTitle,
            href: `/dashboard/campaigns/${a.campaign_id}`,
            time: a.updated_at || a.created_at,
          });
        }

        items.sort((a, b) => parseTimestamp(b.time) - parseTimestamp(a.time));

        if (!cancelled) {
          setNotifications(items);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const formatTime = (iso: string) => {
    const ms = parseTimestamp(iso);
    if (!Number.isFinite(ms)) return "";
    const now = Date.now();
    const diff = now - ms;
    // A slightly-future timestamp (clock skew between DB and browser) should
    // read "just now", not a negative age.
    if (diff < 60_000) return t("time.justNow");
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return t("time.minutesAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("time.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("time.daysAgo", { count: days });
    return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {notifications.length > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {notifications.length > 9 ? "9+" : notifications.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t("title")}</h3>
            <span className="text-[10px] font-semibold text-gray-400">{notifications.length}</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-xs text-gray-400">{t("loading")}</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-700 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty.title")}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("empty.subtitle")}</p>
              </div>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    n.type === "quote_request"
                      ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                      : "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                  }`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {n.type === "quote_request" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      )}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{n.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{n.subtitle}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{formatTime(n.time)}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
