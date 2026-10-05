// URL-driven sorting for the dashboard list pages.
//
// Plain module, NOT "use server": these are values and pure functions.
//
// THE SECURITY POINT, first because it is the whole reason this file exists
// instead of a line of inline code on each page: the sort column is
// interpolated into `.order()` on the RLS-bypassing service-role client.
// PostgREST's order parameter accepts a column list, a direction and a
// nulls modifier, so a value taken straight from `?sort=` is an injection
// surface of exactly the same shape as the hand-built `.or()` filters that
// `sanitizeSearchTerm` exists for. Sanitising it is not enough — a valid
// column name can still be one the page was never meant to order by, or
// one it does not even select.
//
// So a page declares its sortable columns as an ALLOWLIST and the URL only
// ever carries a `key` into it. An unknown key falls back to the page's
// default; nothing from the query string reaches `.order()`.
//
// Param format is a single `sort=<key>:<dir>` (e.g. `sort=followers:desc`)
// rather than two params, so one value is enough to describe the state and
// a link only has to set one thing.

export type SortDir = "asc" | "desc";

export type SortOption = {
  /** URL token. Short, stable, lowercase — it shows up in shared links. */
  key: string;
  /** The real column. Never comes from user input. */
  column: string;
  label: string;
  /**
   * Direction applied the FIRST time this column is chosen. Dates and
   * counts want newest/largest first; names want A→Z. Getting this right
   * means one click does the obvious thing.
   */
  defaultDir?: SortDir;
  /**
   * PostgREST puts NULLs last on DESC and first on ASC by default, so a
   * column with empty values buries the populated rows exactly half the
   * time. Set this and both directions put NULLs at the end.
   */
  nullsLast?: boolean;
  /**
   * A stable second column, so rows with equal primary values keep a fixed
   * order instead of shuffling between pages (PostgREST gives no guarantee
   * without it, which makes paging through a tie look like missing rows).
   */
  tiebreak?: { column: string; ascending: boolean };
};

export type ResolvedSort = {
  key: string;
  column: string;
  ascending: boolean;
  nullsLast: boolean;
  tiebreak?: { column: string; ascending: boolean };
  /** The exact `sort=` value this resolves to, for building links. */
  token: string;
};

const DIRS: SortDir[] = ["asc", "desc"];

function parseToken(raw: unknown): { key: string; dir: SortDir | null } {
  const s = String(raw ?? "").trim();
  if (!s) return { key: "", dir: null };
  const [keyPart, dirPart] = s.split(":");
  const dir = DIRS.includes(dirPart as SortDir) ? (dirPart as SortDir) : null;
  return { key: String(keyPart || "").trim().toLowerCase(), dir };
}

export function sortToken(key: string, dir: SortDir): string {
  return `${key}:${dir}`;
}

// Resolve `?sort=` against a page's allowlist.
//
// `fallbackKey` is what the page has always ordered by, so a page with no
// sort in the URL keeps the behaviour it had before sorting existed.
export function resolveSort(
  raw: unknown,
  options: SortOption[],
  fallbackKey?: string,
): ResolvedSort {
  const { key, dir } = parseToken(raw);
  const chosen =
    options.find((o) => o.key === key) ||
    options.find((o) => o.key === fallbackKey) ||
    options[0];
  if (!chosen) {
    // A page with no sortable columns declared. Returning a resolved sort
    // with an empty column lets applySort become a no-op rather than
    // throwing inside a server component render.
    return { key: "", column: "", ascending: false, nullsLast: false, token: "" };
  }
  // The direction is the URL's when it named one AND named a real column;
  // otherwise the column's own default.
  const useUrlDir = dir !== null && chosen.key === key;
  const effective: SortDir = useUrlDir ? dir : chosen.defaultDir || "desc";
  return {
    key: chosen.key,
    column: chosen.column,
    ascending: effective === "asc",
    nullsLast: !!chosen.nullsLast,
    tiebreak: chosen.tiebreak,
    token: sortToken(chosen.key, effective),
  };
}

// What a header link should point at: the same column flipped, or a new
// column at its own default direction.
export function nextToken(option: SortOption, current: ResolvedSort): string {
  if (option.key === current.key) {
    return sortToken(option.key, current.ascending ? "desc" : "asc");
  }
  return sortToken(option.key, option.defaultDir || "desc");
}

/**
 * Apply a resolved sort to a PostgREST query.
 *
 * Only ever receives a column from the allowlist above — pages must not
 * call `.order()` with anything derived from `searchParams` themselves.
 */
export function applySort<T>(query: T, sort: ResolvedSort): T {
  if (!sort.column) return query;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let q = (query as any).order(sort.column, {
    ascending: sort.ascending,
    ...(sort.nullsLast ? { nullsFirst: false } : {}),
  });
  if (sort.tiebreak) {
    q = q.order(sort.tiebreak.column, { ascending: sort.tiebreak.ascending });
  }
  return q as T;
}

// Build the href for a sort link, preserving every other filter and
// dropping page cursors — a new order is a new first page, and keeping
// `?page=7` would land the admin in the middle of a re-sorted list.
export function sortHref(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
  token: string,
  sortParam = "sort",
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === sortParam) continue;
    if (k === "page" || k.endsWith("_page")) continue;
    next.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  next.set(sortParam, token);
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// A comparator for the handful of pages that sort rows already in memory —
// a list assembled from two tables, or one whose sort key is computed
// rather than stored (a derived status, a blended total). Those cannot push
// the order into PostgREST, so they share this instead of hand-rolling it.
export function compareBy<T>(
  rows: T[],
  value: (row: T) => string | number | null | undefined,
  ascending: boolean,
): T[] {
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    // Empty always sorts last, in both directions — same reasoning as
    // nullsLast above.
    const aEmpty = av === null || av === undefined || av === "";
    const bEmpty = bv === null || bv === undefined || bv === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return ascending ? av - bv : bv - av;
    }
    const cmp = String(av).localeCompare(String(bv), "en", { sensitivity: "base", numeric: true });
    return ascending ? cmp : -cmp;
  });
}
