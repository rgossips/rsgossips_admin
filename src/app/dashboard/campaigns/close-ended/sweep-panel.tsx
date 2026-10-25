"use client";

import { useState } from "react";
import { ButtonSpinner } from "@/components/spinner";
import { prepareEndedSweep, applyEndedSweep, notifyEndedSweepChunk, type SweepNotifyResult } from "./sweep-actions";
import { SWEEP_NOTIFY_CHUNK } from "./sweep-constants";
import type { SweepCreator, SweepPlan } from "@/lib/campaign-sweep";

type Phase = "idle" | "planning" | "planned" | "closing" | "notifying" | "done";

function Stat({ value, label, tone = "" }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60">
      <p className={`text-xl font-bold ${tone || "text-gray-900 dark:text-white"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
    </div>
  );
}

export function SweepPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<SweepPlan | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [closed, setClosed] = useState<{ campaigns: number; applications: number } | null>(null);
  const [queue, setQueue] = useState<SweepCreator[]>([]);
  const [sent, setSent] = useState<SweepNotifyResult[]>([]);

  const runPlan = async () => {
    setPhase("planning");
    setNote(null);
    const p = await prepareEndedSweep();
    if (p.error) {
      setNote(p.error);
      setPhase("idle");
      return;
    }
    setPlan(p);
    setPhase("planned");
  };

  const runSweep = async () => {
    setPhase("closing");
    setNote(null);
    const res = await applyEndedSweep();
    if (res.error) {
      setNote(res.error);
      setPhase("planned");
      return;
    }
    setClosed({ campaigns: res.campaignsCompleted ?? 0, applications: res.applicationsClosed ?? 0 });
    const creators = res.creators ?? [];
    setQueue(creators);

    // Notify in chunks from the browser: SMTP is slow, one request per
    // chunk keeps each inside the function timeout, and the admin sees it
    // happen. The state change is already committed by this point, so a
    // tab closed mid-run leaves correct data and some people untold —
    // which is why the remaining count stays on screen.
    setPhase("notifying");
    const out: SweepNotifyResult[] = [];
    for (let i = 0; i < creators.length; i += SWEEP_NOTIFY_CHUNK) {
      const chunk = creators.slice(i, i + SWEEP_NOTIFY_CHUNK);
      const r = await notifyEndedSweepChunk(
        chunk.map((c) => ({ influencerId: c.influencerId, applicationIds: c.applicationIds })),
      );
      if (r.error) {
        setNote(r.error);
        break;
      }
      out.push(...(r.results || []));
      setSent([...out]);
    }
    setPhase("done");
  };

  const emailed = sent.filter((r) => r.email === "sent").length;
  const emailFailed = sent.filter((r) => r.email === "failed").length;
  const notified = sent.filter((r) => r.notification === "sent").length;
  const notifyFailed = sent.filter((r) => r.notification === "failed").length;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">
          A campaign ending is not an event anything listens for, so undecided applicants on a finished
          campaign stay on <strong>Pending Review</strong> indefinitely. This finds every campaign past its{" "}
          <strong>end date</strong>, marks it completed, closes the applications still undecided on it, and
          tells each creator once — naming every campaign of theirs that closed, rather than sending one
          message per application.
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
          A passed <em>application deadline</em> is deliberately not enough: that only means the campaign
          stopped taking applications, and a brand can still approve someone while it runs. Only an ended
          campaign makes the email&apos;s claim — &ldquo;has finished&rdquo; — true.
        </p>

        {phase === "idle" && (
          <button
            onClick={() => void runPlan()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            Check what would close
          </button>
        )}
        {phase === "planning" && (
          <p className="mt-4 inline-flex items-center gap-2 text-[13px] text-gray-500">
            <ButtonSpinner /> Reading campaigns…
          </p>
        )}
      </div>

      {note && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          {note}
        </p>
      )}

      {plan && phase !== "idle" && phase !== "planning" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
            {closed ? "What was done" : "What will happen"}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat value={closed ? closed.campaigns : plan.campaignsToComplete.length} label="Campaigns completed" />
            <Stat
              value={closed ? closed.applications : plan.applicationIds.length}
              label="Applications closed"
              tone="text-amber-600 dark:text-amber-400"
            />
            <Stat value={plan.creators.length} label="Creators told" />
            <Stat value={plan.creators.filter((c) => c.email).length} label="Have an email" />
          </div>

          {plan.unreachable > 0 && (
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
              {plan.unreachable} application{plan.unreachable === 1 ? " is" : "s are"} invitation-backed with no
              account behind them. They close with the rest, but there is nobody to notify.
            </p>
          )}

          {plan.creators.length === 0 && plan.applicationIds.length === 0 && (
            <p className="mt-3 text-[13px] text-emerald-700 dark:text-emerald-400">
              Nothing to do — no ended campaign has an undecided application.
            </p>
          )}

          {phase === "planned" && plan.applicationIds.length > 0 && (
            <>
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                This sends <strong>{plan.creators.filter((c) => c.email).length} emails</strong> and{" "}
                <strong>{plan.creators.length} push notifications</strong> to real creators, and cannot be
                undone. The busiest {plan.creators[0]?.applicationIds.length ?? 0} applications belong to one
                person and arrive as a single message.
              </p>
              <button
                onClick={() => void runSweep()}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-rose-500"
              >
                Close them and notify
              </button>
            </>
          )}

          {(phase === "closing" || phase === "notifying") && (
            <p className="mt-4 inline-flex items-center gap-2 text-[13px] text-gray-500">
              <ButtonSpinner />
              {phase === "closing"
                ? "Closing applications…"
                : `Notifying ${sent.length} of ${queue.length}…`}
            </p>
          )}

          {sent.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
              <p className="text-[13px] text-gray-700 dark:text-gray-300">
                {emailed} email{emailed === 1 ? "" : "s"} sent
                {emailFailed > 0 && <span className="text-rose-600"> · {emailFailed} failed</span>} ·{" "}
                {notified} notification{notified === 1 ? "" : "s"} delivered
                {notifyFailed > 0 && <span className="text-rose-600"> · {notifyFailed} failed</span>}
              </p>
              {phase === "done" && sent.length < queue.length && (
                <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">
                  {queue.length - sent.length} creator(s) were not reached — their applications are closed.
                </p>
              )}
              <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800">
                {sent.map((r) => (
                  <div
                    key={r.influencerId}
                    className="flex items-center justify-between gap-3 border-b border-gray-50 px-3 py-2 text-[12px] last:border-0 dark:border-gray-800/60"
                  >
                    <span className="truncate text-gray-700 dark:text-gray-300">
                      {r.name}
                      {r.campaigns > 1 && <span className="text-gray-400"> · {r.campaigns} campaigns</span>}
                    </span>
                    <span className="shrink-0 text-gray-400">
                      {r.email === "sent" ? "emailed" : r.email === "failed" ? "email failed" : "no email"} ·{" "}
                      {r.notification === "sent" ? "notified" : "notify failed"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
