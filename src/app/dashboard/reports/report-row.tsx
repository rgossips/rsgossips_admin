"use client";

import { useState, useTransition } from "react";
import { claimReport, resolveReport, suspendReportedUser } from "./actions";
import { ButtonSpinner } from "@/components/spinner";

interface Report {
  id: string;
  reporter_id: string;
  reported_user: string;
  entity_type: string;
  entity_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
}

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// Deep link to whatever was reported, so a moderator can see the content
// rather than judging from the reason alone. 'user' has no entity_id.
function targetHref(r: Report): string | null {
  switch (r.entity_type) {
    case "campaign":
      return r.entity_id ? `/dashboard/campaigns/${r.entity_id}` : null;
    case "user":
      return null;
    default:
      return null;
  }
}

export function ReportRow({
  report,
  reporterName,
  reportedName,
  reasonLabel,
  statusClass,
}: {
  report: Report;
  reporterName: string;
  reportedName: string;
  reasonLabel: string;
  statusClass: string;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");

  const open = report.status === "open" || report.status === "reviewing";

  const run = (fn: () => Promise<void>) => {
    setError("");
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      }
    });
  };

  const href = targetHref(report);

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${statusClass}`}>
              {report.status}
            </span>
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">
              {report.entity_type}
            </span>
          </div>
          <p className="mt-2 text-sm font-black text-gray-900 dark:text-gray-100">{reasonLabel}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            <span className="font-semibold">{reportedName}</span> reported by{" "}
            <span className="font-semibold">{reporterName}</span> · {formatDate(report.created_at)}
          </p>
          {report.details && (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
              {report.details}
            </p>
          )}
          {report.resolution && (
            <p className="mt-2 text-xs text-emerald-700">
              Resolved {formatDate(report.resolved_at)} — {report.resolution}
            </p>
          )}
          {href && (
            <a href={href} className="mt-2 inline-block text-xs font-bold text-blue-600 hover:underline">
              View reported content →
            </a>
          )}
        </div>

        {open && (
          <div className="flex flex-wrap items-center gap-2">
            {report.status === "open" && (
              <button
                onClick={() => run(() => claimReport(report.id))}
                disabled={pending}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                {pending ? <ButtonSpinner /> : "Start review"}
              </button>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200"
            >
              Resolve…
            </button>
          </div>
        )}
      </div>

      {expanded && open && (
        <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you decide? (kept for the audit trail)"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => run(() => resolveReport(report.id, "dismissed", note))}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200"
            >
              Dismiss
            </button>
            <button
              onClick={() => run(() => resolveReport(report.id, "actioned", note))}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              Mark actioned
            </button>
            <button
              onClick={() => {
                if (!note.trim()) {
                  setError("Add a reason before suspending — it is written to the account record.");
                  return;
                }
                // Suspension blocks sign-in immediately and purges after 30
                // days, so it gets an explicit confirm rather than a one-tap.
                if (!confirm(`Suspend ${reportedName}? Sign-in is blocked immediately and the account is permanently removed after 30 days unless restored.`)) return;
                run(() => suspendReportedUser(report.id, report.reported_user, note));
              }}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Suspend account
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
