"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getAwaitingActionFeed, markNotificationsRead } from "@/app/dashboard/ops-actions";
import { formatStatus } from "@/lib/format";

interface Notification {
  id: string;
  type: "quote_request" | "submission" | "application" | "campaign_review" | "brand_verification" | "payout_due" | "delivery_stalled" | "callback" | "admin_campaign_update";
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
  // Dismissed items, by the bell's own synthetic id. Server-held (migration
  // 082) so the same admin on their phone sees what they already cleared at
  // their desk, and so one admin reading something does not clear it for
  // everyone else.
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set());
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
    let cancelled = false;
    let inFlight = false;

    // Polls only while the tab is visible. It used to poll every 20s forever,
    // so a background admin tab kept firing ~5 Supabase requests per tick
    // (auth + role gate + 3 queries) all day — seen in the API logs as 21
    // bell polls vs 2 badge polls in the same 8 minutes, because the badges
    // already paused. Returning to the tab refreshes immediately.
    const load = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        // Awaiting-action items: pending quotes + counter offers + submitted
        // deliverables + campaigns parked in the review queue. Fetched via a
        // server action — the browser client's RLS hides under_review
        // campaigns from an admin session (see ops-actions.ts).
        const feed = await getAwaitingActionFeed();
        if (!feed) {
          if (!cancelled) setLoading(false);
          return;
        }

        const items: Notification[] = [];

        for (const q of feed.quotes) {
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

        for (const a of feed.submissions) {
          const campaignTitle = a.campaign_title || t("campaignFallback");
          items.push({
            id: `app-${a.id}`,
            type: "submission",
            title: t("deliverablesSubmitted"),
            subtitle: campaignTitle,
            href: `/dashboard/campaigns/${a.campaign_id}`,
            time: a.updated_at || a.created_at,
          });
        }

        for (const c of feed.reviews) {
          const brandName = c.brand_name;
          items.push({
            id: `review-${c.campaign_id}`,
            type: "campaign_review",
            title: t("campaignAwaitingApproval"),
            subtitle: brandName ? `${c.title || t("campaignFallback")} · ${brandName}` : c.title || t("campaignFallback"),
            href: `/dashboard/campaigns/${c.campaign_id}`,
            time: c.created_at,
          });
        }

        for (const b of feed.verifications) {
          items.push({
            id: `verify-${b.brand_id}`,
            type: "brand_verification",
            title: t("brandAwaitingVerification"),
            subtitle: b.brand_name || t("brandFallback"),
            href: `/dashboard/brands/${b.brand_id}`,
            time: b.created_at,
          });
        }

        for (const p of feed.payouts) {
          const amount = p.amount_paise != null ? `₹${Math.round(p.amount_paise / 100).toLocaleString("en-IN")}` : null;
          items.push({
            id: `payout-${p.id}`,
            type: "payout_due",
            title: t("payoutDue"),
            subtitle: [amount, p.creator_name, p.campaign_title].filter(Boolean).join(" · ") || t("campaignFallback"),
            // The Payouts page opens on its Scheduled tab by default.
            href: "/dashboard/payouts",
            // The due time, so an overdue payout sorts by how long it's waited.
            time: p.release_at,
          });
        }

        // Barter product that never landed. Two different problems, so two
        // different lines: the creator told us it didn't arrive, or they went
        // quiet past the date it should have.
        for (const d of feed.deliveries ?? []) {
          items.push({
            id: `delivery-${d.id}`,
            type: "delivery_stalled",
            title: d.received === false ? t("deliveryNotReceived") : t("deliveryUnconfirmed"),
            subtitle: [d.creator_name, d.campaign_title].filter(Boolean).join(" · ") || t("campaignFallback"),
            href: `/dashboard/campaigns/${d.campaign_id}`,
            // The date it was due, so the longest-stalled sorts up with the
            // other overdue items.
            time: d.expected_at || "",
          });
        }

        // Somebody asked us to telephone them. Unlike everything else here,
        // a person is sitting waiting for the phone to ring.
        for (const c of feed.callbacks ?? []) {
          items.push({
            id: `callback-${c.id}`,
            type: "callback",
            title: t("callbackRequested"),
            subtitle: [c.phone, c.topic, c.role].filter(Boolean).join(" · ") || t("campaignFallback"),
            href: "/dashboard/callbacks",
            time: c.created_at,
          });
        }

        // Our own campaigns: there is no brand account behind them, so these
        // changes would otherwise reach nobody at all.
        for (const u of feed.adminCampaignUpdates ?? []) {
          items.push({
            id: `adminupd-${u.id}`,
            type: "admin_campaign_update",
            // "new -> pending" is somebody applying; everything else is a move.
            title: !u.from_status
              ? t("newApplicationOnOurCampaign")
              : t("statusChangedOnOurCampaign", { status: formatStatus(u.to_status) }),
            subtitle: [u.creator_name, u.campaign_title].filter(Boolean).join(" · ") || t("campaignFallback"),
            href: `/dashboard/campaigns/${u.campaign_id}`,
            time: u.created_at,
          });
        }

        items.sort((a, b) => parseTimestamp(b.time) - parseTimestamp(a.time));

        if (!cancelled) {
          setReadKeys(new Set(feed.readKeys ?? []));
          setNotifications(items);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      } finally {
        inFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void load();
    };

    void load();
    // 30s, matching the shared ops-badges poll — the bell and the badges show
    // the same queues, so polling one faster than the other only added load.
    const interval = setInterval(load, 30_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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

  const unread = notifications.filter((n) => !readKeys.has(n.id));

  // Optimistic: the row greys out immediately and the server catches up. A
  // failed write just means it comes back on the next poll, which is a
  // better outcome than blocking the click.
  const dismiss = async (keys: string[]) => {
    if (keys.length === 0) return;
    setReadKeys((prev) => new Set([...prev, ...keys]));
    await markNotificationsRead(keys).catch(() => {});
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
        {unread.length > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t("title")}</h3>
            <div className="flex items-center gap-3">
              {unread.length > 0 && (
                <button
                  type="button"
                  onClick={() => dismiss(unread.map((n) => n.id))}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
                >
                  {t("markAllRead")}
                </button>
              )}
              <span className="text-[10px] font-semibold text-gray-400">
                {unread.length}/{notifications.length}
              </span>
            </div>
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
                <div
                  key={n.id}
                  className={`group relative border-b border-gray-50 last:border-0 dark:border-gray-800 ${readKeys.has(n.id) ? "opacity-50" : ""}`}
                >
                {/* Marking one read without opening it. Outside the Link: a
                    button inside an anchor is invalid, and on touch the two
                    targets fight. */}
                {!readKeys.has(n.id) && (
                  <button
                    type="button"
                    aria-label={t("markRead")}
                    title={t("markRead")}
                    onClick={() => dismiss([n.id])}
                    className="absolute right-2 top-2 z-10 hidden rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600 group-hover:block dark:hover:bg-gray-800 cursor-pointer"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                )}
                <Link
                  href={n.href}
                  onClick={() => {
                    // Opening it counts as reading it.
                    dismiss([n.id]);
                    setOpen(false);
                  }}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    n.type === "quote_request"
                      ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                      : n.type === "campaign_review"
                      ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                      : n.type === "brand_verification"
                      ? "bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400"
                      : n.type === "payout_due"
                      ? "bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400"
                      : n.type === "delivery_stalled"
                      ? "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400"
                      : n.type === "callback"
                      ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                      : n.type === "admin_campaign_update"
                      ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400"
                      : "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                  }`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {n.type === "quote_request" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      ) : n.type === "campaign_review" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                      ) : n.type === "payout_due" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      ) : n.type === "admin_campaign_update" ? (
                        // A megaphone: our own campaign moved.
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                      ) : n.type === "callback" ? (
                        // A telephone handset.
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      ) : n.type === "delivery_stalled" ? (
                        // A parcel.
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      ) : n.type === "brand_verification" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
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
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
