import Link from "next/link";
import { nextToken, sortHref, type ResolvedSort, type SortOption } from "@/lib/sorting";

// Sort controls for the list pages.
//
// Server-safe by construction — `<Link>`s only, no hooks, no client bundle,
// the same choice `Pagination` made. That matters because these sit inside
// both server components and client tables (the campaigns table, the error
// triage list), and a component that needed `useSearchParams` could only
// live in one of those.
//
// Two surfaces, because every list page renders a table from `lg` up and
// cards below it (see CLAUDE.md): a card has no column headers to click, so
// sorting would simply be missing on a phone. SortMenu is that half, and it
// uses <details>/<summary> so it opens with no JavaScript at all.

const ARROW_UP = "M5 15l7-7 7 7";
const ARROW_DOWN = "M19 9l-7 7-7-7";

function Chevron({ up, className = "" }: { up: boolean; className?: string }) {
  return (
    <svg className={`h-3.5 w-3.5 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={up ? ARROW_UP : ARROW_DOWN} />
    </svg>
  );
}

export type SortControlProps = {
  option: SortOption;
  current: ResolvedSort;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  sortParam?: string;
  /** Right-align for numeric columns, so the arrow sits beside the digits. */
  align?: "left" | "right";
  className?: string;
};

/**
 * The clickable contents of a table header cell. Renders the label plus a
 * direction arrow, solid on the active column and faint on the others, so
 * it is visible that a column CAN be sorted before it has been.
 *
 * Put it inside the page's own <th> rather than rendering one, so each
 * table keeps its own header padding and borders.
 */
export function SortLink({
  option,
  current,
  basePath,
  params,
  sortParam = "sort",
  align = "left",
  className = "",
}: SortControlProps) {
  const active = option.key === current.key;
  const href = sortHref(basePath, params, nextToken(option, current), sortParam);
  // On the active column the arrow shows the CURRENT direction (what you
  // are looking at), not the direction the click would apply — an arrow
  // that disagrees with the visible order reads as a bug.
  const up = active ? current.ascending : (option.defaultDir || "desc") === "asc";
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={`Sort by ${option.label}`}
      className={`group inline-flex items-center gap-1 ${
        align === "right" ? "flex-row-reverse" : ""
      } ${active ? "text-gray-900 dark:text-white" : "hover:text-gray-700 dark:hover:text-gray-200"} ${className}`}
    >
      <span className={active ? "font-bold" : ""}>{option.label}</span>
      <Chevron
        up={up}
        className={active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-gray-600"}
      />
    </Link>
  );
}

/**
 * The card-view half: a disclosure listing every sortable column, with the
 * active one marked. <details> rather than a dropdown so it needs no state
 * and no JS — it also collapses on navigation for free, because the page
 * re-renders.
 */
export function SortMenu({
  options,
  current,
  basePath,
  params,
  sortParam = "sort",
  label = "Sort",
  className = "",
}: {
  options: SortOption[];
  current: ResolvedSort;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  sortParam?: string;
  label?: string;
  className?: string;
}) {
  if (options.length === 0) return null;
  const activeOption = options.find((o) => o.key === current.key);
  return (
    <details className={`group relative ${className}`}>
      <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M6 12h12M10 17h4" />
        </svg>
        <span>
          {label}
          {activeOption ? (
            <span className="font-normal text-gray-500 dark:text-gray-400">
              {": "}
              {activeOption.label} {current.ascending ? "↑" : "↓"}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="absolute left-0 z-40 mt-1 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
        {options.map((option) => {
          const active = option.key === current.key;
          // Both directions are offered outright here. A card list has no
          // header to click twice, so a single toggling row would make the
          // other direction unreachable without guessing.
          return (
            <div key={option.key} className="flex items-stretch">
              <span
                className={`flex-1 truncate px-3 py-2 text-[13px] ${
                  active ? "font-bold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"
                }`}
              >
                {option.label}
              </span>
              {(["asc", "desc"] as const).map((dir) => {
                const on = active && current.ascending === (dir === "asc");
                return (
                  <Link
                    key={dir}
                    href={sortHref(basePath, params, `${option.key}:${dir}`, sortParam)}
                    scroll={false}
                    aria-label={`Sort by ${option.label} ${dir === "asc" ? "ascending" : "descending"}`}
                    className={`flex w-9 items-center justify-center border-l border-gray-100 dark:border-gray-800 ${
                      on
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                        : "text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    <Chevron up={dir === "asc"} />
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </details>
  );
}

/**
 * Both surfaces in one call, for a page that just wants "sorting here".
 * The menu is hidden from `lg` up, where the table headers take over.
 */
export function SortBar({
  options,
  current,
  basePath,
  params,
  sortParam = "sort",
  label,
  className = "",
}: {
  options: SortOption[];
  current: ResolvedSort;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  sortParam?: string;
  label?: string;
  className?: string;
}) {
  return (
    <SortMenu
      options={options}
      current={current}
      basePath={basePath}
      params={params}
      sortParam={sortParam}
      label={label}
      className={`lg:hidden ${className}`}
    />
  );
}
