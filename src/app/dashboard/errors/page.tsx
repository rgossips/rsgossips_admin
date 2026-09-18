import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { RefreshButton } from "@/components/refresh-button";
import { ErrorsTable, type ErrorRow, type ErrorUser } from "./errors-table";
import { DeleteOldErrorsButton } from "./delete-old-errors-button";
import { ERROR_RETENTION_DAYS } from "./constants";

// Module scope, not inline in the component: reading the clock during render
// trips react-hooks/purity.
function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

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

// Triage state (RS_Gossips migration 068). The page opens on the open queue.
const STATUSES = [
  { id: "open", label: "Open" },
  { id: "addressed", label: "Addressed" },
  { id: "all", label: "All" },
];

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
    status?: string;
  }>;
}) {
  if (!(await isAdminOrAbove())) redirect("/dashboard");

  const sp = await searchParams;
  const status = STATUSES.some((s) => s.id === sp.status) ? (sp.status as string) : "open";
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

  // Is the status column there yet? A cheap probe, so a missing migration
  // degrades to the old read-only list instead of the "table missing" state.
  const statusProbe = await admin.from("error_logs").select("status").limit(1);
  const statusLive = !statusProbe.error;
  if (statusLive) current.status = status;

  let query = admin
    .from("error_logs")
    .select("*", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (statusLive && status !== "all") query = query.eq("status", status);
  if (area) query = query.eq("area", area);
  if (severity) query = query.eq("severity", severity);
  if (source) query = query.eq("source", source);
  if (days && days !== "0") {
    query = query.gte("occurred_at", daysAgoIso(Number(days)));
  }
  // Free text hits the two fields worth searching. Commas break PostgREST's
  // or() grammar, so they are stripped rather than escaped.
  if (q) {
    const safe = q.replace(/[,()]/g, " ").trim();
    if (safe) query = query.or(`message.ilike.%${safe}%,event.ilike.%${safe}%`);
  }

  const [{ data, count, error }, oldRes] = await Promise.all([
    query,
    // How many rows the "Delete old" button would remove.
    admin.from("error_logs").select("id", { count: "exact", head: true }).lt("occurred_at", daysAgoIso(ERROR_RETENTION_DAYS)),
  ]);
  const oldCount = oldRes.count ?? 0;
  const rows: ErrorRow[] = (data as ErrorRow[]) || [];

  // Resolve each row's user_id to a creator or brand so the User column can
  // link to their detail page. user_role on the row is the caller's JWT role
  // (often just "authenticated"), so the profile tables are the authority.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))];
  const users: Record<string, ErrorUser> = {};
  if (userIds.length) {
    const [infRes, brandRes] = await Promise.all([
      admin.from("influencer_profiles").select("influencer_id, full_name, instagram_handle").in("influencer_id", userIds),
      admin.from("brand_profiles").select("brand_id, brand_name").in("brand_id", userIds),
    ]);
    for (const b of brandRes.data || []) {
      users[b.brand_id] = { href: `/dashboard/brands/${b.brand_id}`, name: b.brand_name || null, kind: "brand" };
    }
    for (const p of infRes.data || []) {
      users[p.influencer_id] = {
        href: `/dashboard/influencers/${p.influencer_id}`,
        name: p.full_name || (p.instagram_handle ? `@${p.instagram_handle}` : null),
        kind: "creator",
      };
    }
  }
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!tableMissing && <DeleteOldErrorsButton oldCount={oldCount} />}
          <Link
            href="/dashboard/errors/analytics"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[13px] font-semibold text-white hover:bg-indigo-500"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M8 17V9m5 8V5m5 12v-6" />
            </svg>
            See analytics
          </Link>
          <RefreshButton />
        </div>
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
            {statusLive && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</span>
                <select name="status" defaultValue={status} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800">
                  {STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
            )}

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

          {!statusLive && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
              Checkboxes and the Addressed status appear once migration 068 is applied (<code>npx supabase db push</code>).
            </p>
          )}

          <p className="text-[12px] text-gray-500">
            {total.toLocaleString("en-IN")}
            {statusLive && status !== "all" ? ` ${status}` : ""} error{total === 1 ? "" : "s"}
            {days !== "0" ? ` in the last ${days} day${days === "1" ? "" : "s"}` : " all time"}
            {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}
          </p>

          <ErrorsTable rows={rows} statusLive={statusLive} users={users} />

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
