"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { NotificationRow, useOpsNotifications, type Notification } from "./notification-bell";
import { needsAction, isHighImportance } from "@/lib/ops-priority";

// The streams, in the order they appear as filter tiles. Kept as a list
// rather than derived from what happens to be in the feed today, so the
// tiles do not reshuffle as items are cleared — a filter that moves while
// you are working through it is worse than one showing a zero.
const TYPES = [
  "campaign_review",
  "brand_verification",
  "payout_due",
  "delivery_stalled",
  "callback",
  "quote_request",
  "submission",
  "admin_campaign_update",
] as const;

const TILE_TONE: Record<string, string> = {
  // The two priority tiles. Red only for "high": if every tile shouts,
  // none of them does.
  high: "text-rose-600 dark:text-rose-400",
  campaign_review: "text-emerald-600 dark:text-emerald-400",
  brand_verification: "text-sky-600 dark:text-sky-400",
  payout_due: "text-rose-600 dark:text-rose-400",
  delivery_stalled: "text-orange-600 dark:text-orange-400",
  callback: "text-red-600 dark:text-red-400",
  quote_request: "text-amber-600 dark:text-amber-400",
  admin_campaign_update: "text-indigo-600 dark:text-indigo-400",
};

export function NotificationsFeed() {
  const t = useTranslations("NotificationBell");
  const { notifications, readKeys, loading, truncated, unread, dismiss, formatTime } =
    useOpsNotifications();
  const [type, setType] = useState<string>("all");
  const [showRead, setShowRead] = useState(false);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const n of notifications) {
      if (readKeys.has(n.id)) continue;
      out[n.type] = (out[n.type] || 0) + 1;
    }
    return out;
  }, [notifications, readKeys]);

  // The two cross-cutting tiles. Counted over UNREAD only, like the rest:
  // a tile that keeps counting what you already cleared stops being a
  // reason to click it.
  const priority = useMemo(() => {
    const open = notifications.filter((n) => !readKeys.has(n.id));
    return {
      action: open.filter(needsAction).length,
      high: open.filter((n) => isHighImportance(n)).length,
    };
  }, [notifications, readKeys]);

  const visible = useMemo(() => {
    let rows = notifications;
    // Read items are hidden by default. They are not history — the feed is
    // derived from live source tables, so a cleared item vanishes on its own
    // once the underlying work is done; keeping them visible would make the
    // page look like nothing had been actioned.
    if (!showRead) rows = rows.filter((n) => !readKeys.has(n.id));
    // The two priority filters cut ACROSS types, so they are their own
    // branch rather than another entry in the type list.
    if (type === "needs_action") rows = rows.filter(needsAction);
    else if (type === "high") rows = rows.filter((n) => isHighImportance(n));
    else if (type !== "all") rows = rows.filter((n) => n.type === type);
    // Applied LAST, so it narrows the selected tile rather than escaping
    // it — searching inside "High importance" should stay inside it.
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((n) => `${n.title} ${n.subtitle}`.toLowerCase().includes(q));
    return rows;
  }, [notifications, readKeys, type, showRead, query]);

  const tiles = [
    // Priority first: these are the reasons to open the page at all. A
    // priority tile is shown even at zero — "nothing urgent" is worth
    // reading, unlike an empty stream tile which is just absence.
    { id: "high", label: t("tabs.high"), count: priority.high },
    { id: "needs_action", label: t("tabs.needsAction"), count: priority.action },
    { id: "all", label: t("tabs.all"), count: unread.length },
    ...TYPES.filter((x) => (counts[x] || 0) > 0).map((x) => ({
      id: x as string,
      label: t(`type.${x}`),
      count: counts[x],
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("pageSubtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showRead}
              onChange={(e) => setShowRead(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            {t("showRead")}
          </label>
          {unread.length > 0 && (
            <button
              type="button"
              onClick={() => dismiss(unread.map((n) => n.id))}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("markAllRead")}
            </button>
          )}
        </div>
      </div>

      {/* Filter tiles, the same shape as the outreach tracker's. The count is
          what gets read first, so it stays visible rather than hiding in a
          dropdown. Horizontal scroll on a phone: the negative margin and
          padding give the focus ring somewhere to live, because
          `overflow-x: auto` forces `overflow-y` to compute as auto too. */}
      <div className="-mx-1 overflow-x-auto px-1 py-1">
        <div className="flex min-w-max gap-2 md:grid md:min-w-0 md:grid-cols-4 lg:grid-cols-5">
          {tiles.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setType(x.id)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                type === x.id
                  ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/40"
                  : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
              }`}
            >
              <p className="whitespace-nowrap text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                {x.label}
              </p>
              <p className={`mt-0.5 text-xl font-bold ${TILE_TONE[x.id] || "text-gray-900 dark:text-white"}`}>
                {x.count}
                {x.id === "all" && truncated ? "+" : ""}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Client-side: every row the page can show is already loaded, so a
          round trip would be a round trip for data the browser is holding.
          Title and subtitle only — the subtitle is where the creator, the
          brand and the campaign name actually live. */}
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {loading ? (
          <p className="p-10 text-center text-sm text-gray-400">{t("loading")}</p>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="mx-auto mb-2 h-10 w-10 text-gray-300 dark:text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {/* "You are all caught up" is a lie when a search simply
                matched nothing — the work is still there, just not on
                screen. Say which of the two it is. */}
            {query.trim() ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("noMatches")}</p>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty.title")}</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t("empty.subtitle")}</p>
              </>
            )}
          </div>
        ) : (
          visible.map((n: Notification) => (
            <NotificationRow
              key={n.id}
              n={n}
              read={readKeys.has(n.id)}
              onDismiss={dismiss}
              formatTime={formatTime}
            />
          ))
        )}
      </div>

      {/* The feed caps each stream at 10, so a busy day genuinely has more
          behind these numbers. Saying so beats a count that quietly lies. */}
      {truncated && (
        <p className="text-center text-xs text-gray-400">{t("truncatedNote")}</p>
      )}
    </div>
  );
}
