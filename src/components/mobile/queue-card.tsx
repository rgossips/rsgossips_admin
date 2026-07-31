import Link from "next/link";

// Presentational mobile card for a decision-queue row (lg:hidden lists). Server
// component — the queue pages render it with their already-fetched row data and
// drop the SAME desktop decision component into `action`, so no logic/actions
// are duplicated, only a compact field mapping.
//
// Two shapes: pass `href` for a whole-card tap-through (detail-page decisions,
// e.g. disputes); pass `action` for an inline decision control (e.g. payouts'
// mark-as-paid). Don't pass both — a button inside a link is invalid.
export function QueueCard({
  href,
  title,
  subtitle,
  amount,
  meta,
  status,
  action,
}: {
  href?: string;
  title: string;
  subtitle?: string;
  amount?: string;
  meta?: string;
  status?: { label: string; className: string };
  action?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{title}</p>
          {subtitle && <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{subtitle}</p>}
        </div>
        {amount && <span className="text-sm font-black text-gray-900 dark:text-white shrink-0">{amount}</span>}
      </div>
      {(status || meta) && (
        <div className="flex items-center gap-2 mt-2">
          {status && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${status.className}`}>
              {status.label}
            </span>
          )}
          {meta && <span className="text-[11px] text-gray-400 truncate">{meta}</span>}
        </div>
      )}
    </>
  );

  const cardClass =
    "block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4";

  if (href && !action) {
    return (
      <Link href={href} className={`${cardClass} active:scale-[0.99] transition-transform`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">{body}</div>
          <svg className="w-4 h-4 shrink-0 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </Link>
    );
  }

  return (
    <div className={cardClass}>
      {body}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
