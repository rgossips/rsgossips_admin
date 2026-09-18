"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setErrorLogStatus } from "./actions";

export type ErrorRow = {
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
  // Present once RS_Gossips migration 068 is applied.
  status?: "open" | "addressed" | null;
  addressed_at?: string | null;
};

const SEVERITY_STYLE: Record<string, string> = {
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
  fatal: "bg-red-600 text-white border-red-600",
};

// Fixed IST zone: identical on the server render and in the browser (no
// hydration mismatch), and it's the admins' clock — the old server-side
// format silently showed Netlify's UTC.
const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const fmtTime = (iso: string | null | undefined) => (iso ? TIME_FMT.format(new Date(iso)) : "");

const checkboxClass =
  "h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 cursor-pointer disabled:cursor-not-allowed";

// A row's user_id resolved server-side to the profile it belongs to.
export type ErrorUser = { href: string; name: string | null; kind: "creator" | "brand" };

export function ErrorsTable({
  rows,
  statusLive,
  users,
}: {
  rows: ErrorRow[];
  statusLive: boolean;
  users: Record<string, ErrorUser>;
}) {
  const router = useRouter();
  const [picked, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const headerRef = useRef<HTMLInputElement>(null);

  // A filter change or refresh swaps the rows. Selection is derived against
  // the visible rows (not trimmed in an effect), so the bulk bar can never
  // act on a row the admin can no longer see.
  const visibleIds = new Set(rows.map((r) => r.id));
  const selected = new Set([...picked].filter((id) => visibleIds.has(id)));

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected(() => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = (ids: string[], status: "open" | "addressed") => {
    if (ids.length === 0) return;
    setMessage(null);
    setBusyIds(new Set(ids));
    startTransition(async () => {
      const result = await setErrorLogStatus(ids, status);
      setBusyIds(new Set());
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      const n = result.updated ?? ids.length;
      setMessage({ kind: "ok", text: `${n} error${n === 1 ? "" : "s"} marked ${status === "addressed" ? "addressed" : "open"}.` });
      setSelected(new Set());
      router.refresh();
    });
  };

  const selectedIds = [...selected];
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const canAddress = selectedRows.some((r) => r.status !== "addressed");
  const canReopen = selectedRows.some((r) => r.status === "addressed");

  return (
    <div className="space-y-2">
      {message && (
        <div
          role="status"
          className={`rounded-lg border px-3 py-2 text-[12px] ${
            message.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Bulk action bar — sticky so it stays reachable on a long page */}
      {statusLive && selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/95 px-3 py-2 shadow-sm backdrop-blur dark:border-indigo-900/60 dark:bg-indigo-950/80">
          <span className="text-[12px] font-semibold text-indigo-900 dark:text-indigo-200">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || !canAddress}
              onClick={() => apply(selectedIds.filter((id) => rows.find((r) => r.id === id)?.status !== "addressed"), "addressed")}
              className="h-8 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {pending ? "Saving…" : "Mark addressed"}
            </button>
            <button
              type="button"
              disabled={pending || !canReopen}
              onClick={() => apply(selectedIds.filter((id) => rows.find((r) => r.id === id)?.status === "addressed"), "open")}
              className="h-8 rounded-lg border border-gray-300 bg-white px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Reopen
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setSelected(new Set())}
              className="h-8 rounded-lg px-2 text-[12px] font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
        <table className="w-full min-w-[980px] text-left text-[12px]">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400 dark:bg-gray-900">
            <tr>
              {statusLive && (
                <th className="w-8 px-3 py-2">
                  <input
                    ref={headerRef}
                    type="checkbox"
                    aria-label="Select all errors on this page"
                    className={checkboxClass}
                    checked={allSelected}
                    disabled={rows.length === 0 || pending}
                    onChange={toggleAll}
                  />
                </th>
              )}
              <th className="px-3 py-2 font-bold">When (IST)</th>
              {statusLive && <th className="px-3 py-2 font-bold">Status</th>}
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
                <td colSpan={statusLive ? 9 : 7} className="px-3 py-10 text-center text-gray-400">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <ErrorTableRow
                key={r.id}
                row={r}
                statusLive={statusLive}
                user={r.user_id ? users[r.user_id] : undefined}
                checked={selected.has(r.id)}
                busy={busyIds.has(r.id)}
                disabled={pending}
                onToggle={toggleOne}
                onSetStatus={apply}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Module scope — a subcomponent defined inside ErrorsTable would remount on
// every selection change (see CLAUDE.md "Client component pitfalls").
function ErrorTableRow({
  row: r,
  statusLive,
  user,
  checked,
  busy,
  disabled,
  onToggle,
  onSetStatus,
}: {
  row: ErrorRow;
  statusLive: boolean;
  user?: ErrorUser;
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  onSetStatus: (ids: string[], status: "open" | "addressed") => void;
}) {
  const addressed = r.status === "addressed";
  return (
    <tr
      className={`border-t border-gray-100 align-top dark:border-gray-800 ${checked ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""} ${
        addressed && !checked ? "opacity-60" : ""
      }`}
    >
      {statusLive && (
        <td className="px-3 py-2">
          <input
            type="checkbox"
            aria-label={`Select error ${r.event}`}
            className={checkboxClass}
            checked={checked}
            disabled={disabled}
            onChange={() => onToggle(r.id)}
          />
        </td>
      )}
      <td className="whitespace-nowrap px-3 py-2 text-gray-500">{fmtTime(r.occurred_at)}</td>
      {statusLive && (
        <td className="whitespace-nowrap px-3 py-2">
          <div className="flex flex-col items-start gap-1">
            <span
              title={addressed && r.addressed_at ? `Addressed ${fmtTime(r.addressed_at)}` : undefined}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                addressed
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300"
                  : "border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              {addressed ? "Addressed" : "Open"}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSetStatus([r.id], addressed ? "open" : "addressed")}
              className="text-[10px] font-semibold text-indigo-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer dark:text-indigo-400"
            >
              {busy ? "Saving…" : addressed ? "Reopen" : "Mark addressed"}
            </button>
          </div>
        </td>
      )}
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
              <pre className="mt-1 max-w-[520px] overflow-x-auto rounded bg-gray-50 p-2 text-[10px] dark:bg-gray-800">{r.stack}</pre>
            )}
          </details>
        )}
      </td>
      <td className="px-3 py-2 text-[11px] text-gray-500">
        <div>
          {r.source}
          {r.status_code ? ` · ${r.status_code}` : ""}
        </div>
        <div className="font-mono opacity-70">{r.fn || r.path || "—"}</div>
      </td>
      <td className="px-3 py-2 text-[10px] text-gray-400">
        {!r.user_id ? (
          "—"
        ) : user ? (
          <Link href={user.href} className="group block w-[150px]" title={`Open ${user.kind}`}>
            {user.name && (
              <span className="block truncate text-[11px] font-semibold text-indigo-600 group-hover:underline dark:text-indigo-400">
                {user.name}
              </span>
            )}
            <span className="block break-all font-mono text-indigo-500 group-hover:underline dark:text-indigo-400">{r.user_id}</span>
          </Link>
        ) : (
          // No creator/brand profile — an admin, or a since-deleted account.
          <span className="block w-[150px] break-all font-mono">{r.user_id}</span>
        )}
        {(user?.kind || r.user_role) && <div className="opacity-70">{user?.kind || r.user_role}</div>}
      </td>
    </tr>
  );
}
