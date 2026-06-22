import Link from "next/link";

// Builds a URL preserving the existing query params with one key overridden.
// `currentParams` should be the awaited searchParams from the route.
function buildHref(
  basePath: string,
  currentParams: Record<string, string | undefined>,
  pageParam: string,
  page: number,
) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(currentParams)) {
    if (v != null && v !== "" && k !== pageParam) usp.set(k, v);
  }
  if (page > 1) usp.set(pageParam, String(page));
  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// Tiny page-number window around the current page so the bar stays
// short even on big result sets. Always includes 1 and last; gaps are
// rendered as "…".
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

// Renders prev / page-numbers / next anchors. Server-safe (just <a>'s),
// works from RSC pages without bundling client JS. Pass the same
// searchParams the page already destructured so other filters stay
// intact when the admin clicks a page.
export function Pagination({
  basePath,
  pageParam,
  currentParams,
  page,
  perPage,
  total,
}: {
  basePath: string;
  // Distinct param name so multiple paginated sections on one page
  // (e.g. registered + invited) don't fight over the same key.
  pageParam: string;
  currentParams: Record<string, string | undefined>;
  page: number;
  perPage: number;
  total: number;
}) {
  if (total <= perPage) return null;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = (safePage - 1) * perPage + 1;
  const to = Math.min(safePage * perPage, total);

  const pageLink = (n: number) => buildHref(basePath, currentParams, pageParam, n);
  const pages = pageWindow(safePage, totalPages);

  const btn =
    "inline-flex items-center justify-center min-w-[34px] h-9 px-3 rounded-lg text-xs font-semibold border transition-colors";
  const enabled =
    "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800";
  const active =
    "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-500";
  const disabled =
    "bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 border-gray-100 dark:border-gray-800 cursor-not-allowed";

  return (
    <div className="flex items-center justify-between mt-6 flex-wrap gap-3">
      <p className="text-[12px] text-gray-500 dark:text-gray-400">
        Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{from}–{to}</span> of <span className="font-semibold text-gray-700 dark:text-gray-200">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        {safePage > 1 ? (
          <Link href={pageLink(safePage - 1)} className={`${btn} ${enabled}`}>‹ Prev</Link>
        ) : (
          <span className={`${btn} ${disabled}`} aria-disabled>‹ Prev</span>
        )}
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-2 text-xs text-gray-400">…</span>
          ) : p === safePage ? (
            <span key={p} className={`${btn} ${active}`} aria-current="page">{p}</span>
          ) : (
            <Link key={p} href={pageLink(p)} className={`${btn} ${enabled}`}>{p}</Link>
          ),
        )}
        {safePage < totalPages ? (
          <Link href={pageLink(safePage + 1)} className={`${btn} ${enabled}`}>Next ›</Link>
        ) : (
          <span className={`${btn} ${disabled}`} aria-disabled>Next ›</span>
        )}
      </div>
    </div>
  );
}
