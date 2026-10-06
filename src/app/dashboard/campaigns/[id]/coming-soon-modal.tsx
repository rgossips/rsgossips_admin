"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import { COMING_SOON_CHUNK } from "./coming-soon-constants";
import {
  applyComingSoon,
  notifyComingSoonChunk,
  prepareComingSoon,
  type ComingSoonApplicant,
  type NotifyResult,
} from "./coming-soon-actions";

// Taking a LIVE campaign back to "coming soon".
//
// Two screens, because they answer different questions. First: how many
// people does this affect — asked BEFORE anything is written, so an admin
// who did not realise forty creators had applied can still back out. Then:
// did each of them actually hear about it, one row at a time, because
// "sending 40 emails" as a single spinner tells you nothing about the three
// that failed.
//
// Subcomponents are at module scope. Defined inside a component that owns
// state they would remount on every tick of the progress loop (see
// CLAUDE.md, "Client component pitfalls").

type Phase = "loading" | "confirm" | "working" | "done" | "error";

const DOT: Record<string, string> = {
  sent: "bg-emerald-500",
  skipped: "bg-gray-300 dark:bg-gray-600",
  failed: "bg-rose-500",
  pending: "bg-gray-200 dark:bg-gray-700",
};

function Channel({ state, label }: { state: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      <span className={`h-2 w-2 rounded-full ${DOT[state] || DOT.pending}`} />
      {label}
    </span>
  );
}

function ResultRow({ name, result }: { name: string; result?: NotifyResult }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-2 last:border-0 dark:border-gray-800">
      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800 dark:text-gray-200">{name}</span>
      <span className="flex items-center gap-3">
        <Channel state={result?.email ?? "pending"} label="Email" />
        <Channel state={result?.notification ?? "pending"} label="In-app" />
      </span>
    </li>
  );
}

export function ComingSoonModal({
  campaignId,
  onClose,
  onDone,
}: {
  campaignId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [applicants, setApplicants] = useState<ComingSoonApplicant[]>([]);
  const [untouched, setUntouched] = useState(0);
  const [results, setResults] = useState<Record<string, NotifyResult>>({});
  const [doneCount, setDoneCount] = useState(0);

  // Read-only: nothing has changed yet when this runs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const plan = await prepareComingSoon(campaignId);
      if (cancelled) return;
      if (plan.error) {
        setError(plan.error);
        setPhase("error");
        return;
      }
      setTitle(plan.campaignTitle || "");
      setApplicants(plan.applicants || []);
      setUntouched(plan.untouched || 0);
      setPhase("confirm");
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const run = async () => {
    setPhase("working");
    // The campaign and the applications flip first, in one call. That is the
    // part that must not be half-done; the notifications after it are
    // best-effort and a failure there leaves the state correct regardless.
    const applied = await applyComingSoon(campaignId);
    if (applied.error) {
      setError(applied.error);
      setPhase("error");
      return;
    }

    for (let i = 0; i < applicants.length; i += COMING_SOON_CHUNK) {
      const chunk = applicants.slice(i, i + COMING_SOON_CHUNK);
      const res = await notifyComingSoonChunk(campaignId, chunk);
      if (res.error) {
        // Stop, but keep what already went out on screen — re-running would
        // email the ones who already heard a second time.
        setError(res.error);
        break;
      }
      setResults((prev) => {
        const next = { ...prev };
        for (const r of res.results || []) next[r.applicationId] = r;
        return next;
      });
      setDoneCount(i + chunk.length);
    }

    setPhase("done");
    router.refresh();
    onDone();
  };

  const total = applicants.length;
  const sentEmails = Object.values(results).filter((r) => r.email === "sent").length;
  const noEmail = Object.values(results).filter((r) => r.email === "skipped").length;
  const failed = Object.values(results).filter((r) => r.email === "failed" || r.notification === "failed").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Move to Coming Soon</h3>
            {title && <p className="truncate text-[12px] text-gray-500">{title}</p>}
          </div>
          {phase !== "working" && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-[12px] font-semibold text-gray-500 hover:underline cursor-pointer"
            >
              Close
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {phase === "loading" && (
            <p className="flex items-center gap-2 text-[13px] text-gray-500">
              <ButtonSpinner /> Checking who has applied…
            </p>
          )}

          {phase === "error" && <p className="text-[13px] text-rose-600 dark:text-rose-400">{error}</p>}

          {phase === "confirm" && (
            <div className="space-y-3">
              {total === 0 ? (
                <p className="text-[13px] text-gray-600 dark:text-gray-300">
                  Nobody has applied yet, so this just changes the campaign — no emails, no notifications.
                </p>
              ) : (
                <>
                  <p className="text-[14px] text-gray-800 dark:text-gray-200">
                    <span className="font-bold">{total}</span>{" "}
                    {total === 1 ? "creator has" : "creators have"} already applied to this campaign.
                  </p>
                  <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
                    Their applications will be put on hold — kept, not rejected — and each of them gets an email and
                    an in-app notification telling them the campaign is being prepared and that they do not need to
                    apply again.
                  </p>
                  {untouched > 0 && (
                    <p className="text-[12px] text-gray-500">
                      {untouched} withdrawn, rejected or completed{" "}
                      {untouched === 1 ? "application is" : "applications are"} left alone.
                    </p>
                  )}
                  <ul className="rounded-xl border border-gray-100 px-3 dark:border-gray-800">
                    {applicants.slice(0, 6).map((a) => (
                      <li
                        key={a.applicationId}
                        className="flex items-center justify-between gap-2 border-b border-gray-100 py-2 text-[12px] last:border-0 dark:border-gray-800"
                      >
                        <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">{a.name}</span>
                        <span className="shrink-0 text-[11px] text-gray-400">
                          {a.email ? "has email" : "no email — in-app only"}
                        </span>
                      </li>
                    ))}
                    {applicants.length > 6 && (
                      <li className="py-2 text-[11px] text-gray-400">+{applicants.length - 6} more</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {(phase === "working" || phase === "done") && (
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                {phase === "working" ? `Telling creators… ${doneCount} of ${total}` : `Done — ${total} notified`}
              </p>
              {phase === "done" && (
                <p className="text-[12px] text-gray-500">
                  {sentEmails} {sentEmails === 1 ? "email" : "emails"} sent
                  {noEmail > 0 && `, ${noEmail} had no address on file (in-app only)`}
                  {failed > 0 && `, ${failed} failed`}.
                </p>
              )}
              <ul className="rounded-xl border border-gray-100 px-3 dark:border-gray-800">
                {applicants.map((a) => (
                  <ResultRow key={a.applicationId} name={a.name} result={results[a.applicationId]} />
                ))}
              </ul>
              {error && <p className="text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
          {phase === "confirm" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-xl px-4 text-[13px] font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                className="inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white cursor-pointer"
                style={{ background: "linear-gradient(135deg, #7C3AED 0%, #9810FA 100%)" }}
              >
                {total === 0 ? "Move to Coming Soon" : `Notify ${total} and move`}
              </button>
            </>
          )}
          {phase === "working" && (
            <span className="inline-flex items-center gap-2 text-[12px] text-gray-500">
              <ButtonSpinner /> Please keep this open
            </span>
          )}
          {(phase === "done" || phase === "error") && (
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl bg-gray-900 px-4 text-[13px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900 cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
