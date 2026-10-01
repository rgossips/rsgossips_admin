import Link from "next/link";
import React from "react";

// Presentational card for a LIST row on phones (the `lg:hidden` half of a
// table). Sibling to QueueCard, which covers decision queues — this one
// carries the things a browsing list needs: a leading avatar, a row of
// badges, and a handful of labelled facts.
//
// A data table does not degrade into a usable phone screen. Every list in
// this portal was wrapped in `overflow-x-auto`, which technically fits but
// means sideways-scrolling a 10-column grid with both thumbs to read one
// creator's follower count. These cards show the same data stacked.
//
// Server-component friendly: pass already-rendered nodes for anything
// interactive (`actions`) rather than handlers.
//
// Tap target: whole card when `href` is given. Never pass `href` and an
// interactive `actions` node together — a button inside an anchor is invalid
// HTML and the nested click targets fight each other on touch.

export type CardFact = {
  label: string;
  // A node so a caller can pass a badge, a link, or formatted markup.
  value: React.ReactNode;
};

export function ListCard({
  href,
  leading,
  title,
  subtitle,
  badges,
  facts,
  actions,
  footer,
}: {
  href?: string;
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  facts?: CardFact[];
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start gap-3">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 dark:text-white break-words">{title}</div>
          {subtitle && <div className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400 break-words">{subtitle}</div>}
          {badges && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{badges}</div>}
        </div>
        {href && (
          <svg className="mt-1 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>

      {facts && facts.length > 0 && (
        // Two columns at 360px and up; one below, so a long value never
        // forces the card sideways.
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-gray-100 pt-3 min-[360px]:grid-cols-2 dark:border-gray-800">
          {facts.map((f, i) => (
            <div key={i} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{f.label}</dt>
              <dd className="mt-0.5 break-words text-[13px] text-gray-800 dark:text-gray-200">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {footer && <div className="mt-2.5 text-[11px] text-gray-400">{footer}</div>}
    </>
  );

  const shell = "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900";

  if (href && !actions) {
    return (
      <Link href={href} className={`block ${shell} transition-transform active:scale-[0.99]`}>
        {body}
      </Link>
    );
  }

  return (
    <div className={shell}>
      {href ? (
        <Link href={href} className="block transition-transform active:scale-[0.99]">
          {body}
        </Link>
      ) : (
        body
      )}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">{actions}</div>}
    </div>
  );
}

// The list wrapper. Keeps spacing identical everywhere and makes the
// desktop/mobile split obvious at the call site.
export function CardList({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-3 lg:hidden">{children}</ul>;
}

export function CardListItem({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}
