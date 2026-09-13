import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { RefreshButton } from "@/components/refresh-button";
import { ErrorsAnalyticsChart, type ErrorDay } from "./analytics-chart";

export const dynamic = "force-dynamic";

// Error analytics — the "is it getting better or worse?" view the Errors list
// can't answer. Same admin gate as the list. Aggregated here on the server so
// only daily buckets and top-N summaries reach the browser, never raw rows.

const WINDOWS = [7, 30, 90];
const PAGE = 1000; // PostgREST page cap

type Row = {
  occurred_at: string;
  severity: string;
  area: string;
  event: string;
  source: string;
  user_id: string | null;
  status?: string | null;
};

// Admins read the clock in IST; bucket by the India calendar day.
const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
const TIME_FMT = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Module scope — reading the clock inside the component trips react-hooks/purity.
function windowStart(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

function dayLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`; // same short form as the reference chart
}

async function loadRows(days: number, withStatus: boolean): Promise<{ rows: Row[]; error: string | null }> {
  const admin = createAdminClient();
  const since = windowStart(days).toISOString();
  const cols = `occurred_at, severity, area, event, source, user_id${withStatus ? ", status" : ""}`;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("error_logs")
      .select(cols)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...((data || []) as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

export default async function ErrorsAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!(await isAdminOrAbove())) redirect("/dashboard");

  const sp = await searchParams;
  const days = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : 30;

  const admin = createAdminClient();
  const statusLive = !(await admin.from("error_logs").select("status").limit(1)).error;
  const { rows, error } = await loadRows(days, statusLive);

  // Daily series, zero-filled so quiet days show as gaps, not missing bars.
  const buckets = new Map<string, { errors: number; warnings: number; open: number; users: Set<string> }>();
  const start = windowStart(days);
  for (let i = 0; i <= days; i++) {
    const key = IST_DAY.format(new Date(start.getTime() + i * 86_400_000));
    if (!buckets.has(key)) buckets.set(key, { errors: 0, warnings: 0, open: 0, users: new Set() });
  }

  const isWarn = (s: string) => s === "warn";
  const allUsers = new Set<string>();
  let errorsTotal = 0;
  let warningsTotal = 0;
  let openTotal = 0;
  let addressedTotal = 0;
  const byEvent = new Map<string, { event: string; area: string; source: string; count: number; warn: boolean; last: string; users: Set<string>; open: number }>();
  const byArea = new Map<string, number>();
  const bySource = new Map<string, number>();

  for (const r of rows) {
    const key = IST_DAY.format(new Date(r.occurred_at));
    const b = buckets.get(key) ?? { errors: 0, warnings: 0, open: 0, users: new Set<string>() };
    buckets.set(key, b);
    if (isWarn(r.severity)) {
      b.warnings++;
      warningsTotal++;
    } else {
      b.errors++;
      errorsTotal++;
    }
    if (r.user_id) {
      b.users.add(r.user_id);
      allUsers.add(r.user_id);
    }
    // Before migration 068 there's no status, so every row is still open.
    if (r.status === "addressed") addressedTotal++;
    else {
      openTotal++;
      b.open++;
    }

    const g = byEvent.get(r.event) ?? { event: r.event, area: r.area, source: r.source, count: 0, warn: true, last: r.occurred_at, users: new Set<string>(), open: 0 };
    g.count++;
    if (!isWarn(r.severity)) g.warn = false; // any error-level occurrence makes the group an error
    if (r.occurred_at > g.last) g.last = r.occurred_at;
    if (r.user_id) g.users.add(r.user_id);
    if (r.status !== "addressed") g.open++;
    byEvent.set(r.event, g);

    byArea.set(r.area, (byArea.get(r.area) || 0) + 1);
    bySource.set(r.source, (bySource.get(r.source) || 0) + 1);
  }

  const series: ErrorDay[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({ date, label: dayLabel(date), errors: b.errors, warnings: b.warnings, open: b.open, users: b.users.size }));

  const topIssues = [...byEvent.values()].sort((a, b) => b.count - a.count).slice(0, 15);
  const areas = [...byArea.entries()].sort((a, b) => b[1] - a[1]);
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  const maxArea = areas[0]?.[1] || 1;
  const total = rows.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/errors" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800" aria-label="Back to errors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">Error analytics</h1>
            <p className="text-[12px] text-gray-500">
              {total.toLocaleString("en-IN")} logged in the last {days} days · days in IST
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/dashboard/errors/analytics?days=${w}`}
                className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
                  w === days ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                }`}
              >
                {w} days
              </Link>
            ))}
          </div>
          <RefreshButton />
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          Couldn&apos;t load error analytics. Is migration 066 (error_logs) applied?
          <p className="mt-1 font-mono text-[11px] opacity-70">{error}</p>
        </div>
      ) : (
        <>
          <ErrorsAnalyticsChart
            days={series}
            totals={{ errors: errorsTotal, warnings: warningsTotal, open: openTotal, users: allUsers.size }}
            statusLive={statusLive}
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Top issues */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 lg:col-span-2">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Top issues</h2>
                <span className="text-[11px] text-gray-400">by occurrences</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[12px]">
                  <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400 dark:bg-gray-800/40">
                    <tr>
                      <th className="px-4 py-2 font-bold">Event</th>
                      <th className="px-4 py-2 text-right font-bold">Count</th>
                      <th className="px-4 py-2 text-right font-bold">Users</th>
                      {statusLive && <th className="px-4 py-2 text-right font-bold">Open</th>}
                      <th className="px-4 py-2 font-bold">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topIssues.length === 0 && (
                      <tr>
                        <td colSpan={statusLive ? 5 : 4} className="px-4 py-10 text-center text-gray-400">No errors in this window.</td>
                      </tr>
                    )}
                    {topIssues.map((g) => (
                      <tr key={g.event} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${g.warn ? "bg-[#e8a33b]" : "bg-[#d9463b]"}`} />
                            <span className="font-mono text-[11px] text-gray-800 dark:text-gray-100">{g.event}</span>
                          </div>
                          <div className="ml-4 text-[11px] text-gray-400">
                            {g.area} · {g.source}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{g.count}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{g.users.size || "—"}</td>
                        {statusLive && <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{g.open}</td>}
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{TIME_FMT.format(new Date(g.last))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-5">
              {/* By area */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">By area</h2>
                {areas.length === 0 ? (
                  <p className="text-[12px] text-gray-400">No data.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {areas.map(([area, n]) => (
                      <li key={area}>
                        <div className="mb-1 flex justify-between text-[12px]">
                          <Link href={`/dashboard/errors?area=${encodeURIComponent(area)}&days=${days}&status=all`} className="text-gray-700 hover:text-indigo-600 hover:underline dark:text-gray-200">
                            {area}
                          </Link>
                          <span className="tabular-nums text-gray-500">{n}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(4, (n / maxArea) * 100)}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Source + status */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">By source</h2>
                <div className="flex flex-wrap gap-2">
                  {sources.length === 0 && <span className="text-[12px] text-gray-400">No data.</span>}
                  {sources.map(([src, n]) => (
                    <span key={src} className="rounded-lg bg-gray-100 px-2.5 py-1 text-[12px] text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                      {src} <span className="font-semibold tabular-nums">{n}</span>
                    </span>
                  ))}
                </div>
                {statusLive && total > 0 && (
                  <>
                    <h2 className="mb-2 mt-5 text-sm font-semibold text-gray-900 dark:text-white">Triage</h2>
                    <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div className="bg-emerald-500" style={{ width: `${(addressedTotal / total) * 100}%` }} />
                    </div>
                    <p className="mt-2 text-[12px] text-gray-500">
                      <span className="font-semibold text-emerald-600">{addressedTotal}</span> addressed ·{" "}
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{openTotal}</span> open
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
