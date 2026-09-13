import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { RefreshButton } from "@/components/refresh-button";

export const dynamic = "force-dynamic";

// Error log viewer (migration 066).
//
// Every surface writes here: edge functions through _shared/log.ts, the web
// and mobile clients through the log-client-error function. This is the read
// side — filter, page, and read the context of a single failure.
//
// Gated at admin rather than super-admin: triaging a failed sign-up or a
// payment error is support work, not an ownership decision. The rows carry
// user ids and messages but no secrets — the logger redacts anything
// token-shaped before it is written.

type ErrorRow = {
  id: string;
  occurred_at: string;
  source: string;
  area: string;
  event: string;
  severity: string;
  message: string | null;
  stack: string | null;
  status_code: number | null;
  user_id: string | null;
  user_role: string | null;
  request_id: string | null;
  fn: string | null;
  path: string | null;
  ip_hash: string | null;
  context: Record<string, unknown> | null;
};

const PAGE_SIZE = 50;

// The surfaces the product actually has. Kept as a list rather than a
// SELECT DISTINCT so the filter is stable when a category happens to have no
// errors this week — an empty option is information too.
const AREAS = [
  "instagram",
  "signin",
  "signup",
  "campaign_application",
  "payment",
  "payout",
  "client",
  "other",
];
const SEVERITIES = ["warn", "error", "fatal"];
const SOURCES = ["web", "mobile", "admin", "edge"];
const WINDOWS = [
  { id: "1", label: "24 hours" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "0", label: "All time" },
];

const SEVERITY_STYLE: Record<string, string> = {
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
  fatal: "bg-red-600 text-white border-red-600",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Build a querystring that keeps the current filters and changes one thing —
// so paging does not silently drop the filter you were looking at.
function qs(current: Record<string, string>, patch: Record<string, string | number>) {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === "" || v === undefined || v === null) next.delete(k);
    else next.set(k, String(v));
  }
  return `?${next.toString()}`;
}

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    area?: string;
    severity?: string;
    source?: string;
    q?: string;
    days?: string;
    page?: string;
  }>;
}) {
  if (!(await isAdminOrAbove())) redirect("/dashboard");

  const sp = await searchParams;
  const area = sp.area || "";
  const severity = sp.severity || "";
  const source = sp.source || "";
  const q = (sp.q || "").trim();
  const days = sp.days ?? "7";
  const page = Math.max(1, Number(sp.page) || 1);

  const current: Record<string, string> = {};
  if (area) current.area = area;
  if (severity) current.severity = severity;
  if (source) current.source = source;
  if (q) current.q = q;
  if (days) current.days = days;

  const admin = createAdminClient();

  let query = admin
    .from("error_logs")
    .select("*", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (area) query = query.eq("area", area);
  if (severity) query = query.eq("severity", severity);
  if (source) query = query.eq("source", source);
  if (days && days !== "0") {
    const since = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
    query = query.gte("occurred_at", since);
  }
  // Free text hits the two fields worth searching. Commas break PostgREST's
  // or() grammar, so they are stripped rather than escaped.
  if (q) {
    const safe = q.replace(/[,()]/g, " ").trim();
    if (safe) query = query.or(`message.ilike.%${safe}%,event.ilike.%${safe}%`);
  }

  const { data, count, error } = await query;
  const rows: ErrorRow[] = (data as ErrorRow[]) || [];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Migration not applied yet — say so plainly instead of rendering an empty
  // table that looks like "no errors".
  const tableMissing = !!error;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">Errors</h1>
          <p className="text-[12px] text-gray-500">
            Failures from every surface — edge functions, web and mobile.
          </p>
        </div>
        <RefreshButton />
      </div>

      {tableMissing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <p className="font-semibold">The error_logs table is not there yet.</p>
          <p className="mt-1">
            Apply migration 066 (<code>npx supabase db push</code>) and redeploy the edge
            functions. Until then nothing is being recorded.
          </p>
          <p className="mt-1 font-mono text-[11px] opacity-70">{error?.message}</p>
        </div>
      ) : (
        <>
          {/* Filters. A plain GET form so every view is a shareable URL and the
              back button behaves. */}
          <form
            method="GET"
            className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
          >
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Area</span>
              <select name="area" defaultValue={area} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800">
                <option value="">All</option>
                {AREAS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Severity</span>
              <select name="severity" defaultValue={severity} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800">
                <option value="">All</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Source</span>
              <select name="source" defaultValue={source} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800">
                <option value="">All</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Window</span>
              <select name="days" defaultValue={days} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800">
                {WINDOWS.map((w) => (
                  <option key={w.id} value={w.id}>{w.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-1 flex-col gap-1 min-w-[200px]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Search</span>
              <input
                name="q"
                defaultValue={q}
                placeholder="message or event…"
                className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800"
              />
            </label>

            <button type="submit" className="h-9 rounded-lg bg-gray-900 px-4 text-[13px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
              Apply
            </button>
            <Link href="/dashboard/errors" className="h-9 rounded-lg border border-gray-200 px-4 text-[13px] font-semibold leading-9 text-gray-600 dark:border-gray-700 dark:text-gray-300">
              Clear
            </Link>
          </form>

          <p className="text-[12px] text-gray-500">
            {total.toLocaleString("en-IN")} error{total === 1 ? "" : "s"}
            {days !== "0" ? ` in the last ${days} day${days === "1" ? "" : "s"}` : " all time"}
            {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}
          </p>

          <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
            <table className="w-full min-w-[900px] text-left text-[12px]">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400 dark:bg-gray-900">
                <tr>
                  <th className="px-3 py-2 font-bold">When</th>
                  <th className="px-3 py-2 font-bold">Severity</th>
                  <th className="px-3 py-2 font-bold">Area</th>
                  <th className="px-3 py-2 font-bold">Event</th>
                  <th className="px-3 py-2 font-bold">Message</th>
                  <th className="px-3 py-2 font-bold">Where</th>
                  <th className="px-3 py-2 font-bold">User</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                      Nothing matches these filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top dark:border-gray-800">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{fmtTime(r.occurred_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_STYLE[r.severity] || "border-gray-200 bg-gray-50 text-gray-600"}`}>
                        {r.severity}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-gray-700 dark:text-gray-200">{r.area}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-600 dark:text-gray-300">{r.event}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">
                      <div className="max-w-[420px] truncate" title={r.message || ""}>{r.message || "—"}</div>
                      {(r.stack || (r.context && Object.keys(r.context).length > 0)) && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-gray-400">details</summary>
                          {r.context && Object.keys(r.context).length > 0 && (
                            <pre className="mt-1 max-w-[520px] overflow-x-auto rounded bg-gray-50 p-2 text-[10px] dark:bg-gray-800">
                              {JSON.stringify(r.context, null, 2)}
                            </pre>
                          )}
                          {r.stack && (
                            <pre className="mt-1 max-w-[520px] overflow-x-auto rounded bg-gray-50 p-2 text-[10px] dark:bg-gray-800">
                              {r.stack}
                            </pre>
                          )}
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-500">
                      <div>{r.source}{r.status_code ? ` · ${r.status_code}` : ""}</div>
                      <div className="font-mono opacity-70">{r.fn || r.path || "—"}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-gray-400">
                      {r.user_id ? r.user_id.slice(0, 8) : "—"}
                      {r.user_role ? <div className="opacity-70">{r.user_role}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between">
              <Link
                href={qs(current, { page: page - 1 })}
                aria-disabled={page <= 1}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${page <= 1 ? "pointer-events-none border-gray-100 text-gray-300" : "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200"}`}
              >
                ← Newer
              </Link>
              <span className="text-[12px] text-gray-500">
                Page {page} of {pageCount}
              </span>
              <Link
                href={qs(current, { page: page + 1 })}
                aria-disabled={page >= pageCount}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${page >= pageCount ? "pointer-events-none border-gray-100 text-gray-300" : "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200"}`}
              >
                Older →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
