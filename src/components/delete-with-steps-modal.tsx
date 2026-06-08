"use client";

import { useState } from "react";
import { ButtonSpinner } from "@/components/spinner";

type StepStatus = "queued" | "running" | "done" | "failed";

interface Step {
  key: string;
  label: string;
}

interface StepRunResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

interface DeleteWithStepsModalProps {
  // Controlled open state — the parent owns the trigger button so we
  // don't fight existing in-row affordances (the small "Remove" link on
  // invited-brand cards, etc.).
  open: boolean;
  onClose: () => void;
  // What the admin is removing — drives the heading + bullet list copy.
  title: string;
  subtitle?: string;
  // One-liner bullets that summarise what will be deleted. Shown in the
  // confirm phase. Each row's text matches a step label below.
  bullets: string[];
  // The ordered steps the action will run after the admin confirms.
  steps: Step[];
  // Server action that runs one step and returns the result. Aborting
  // mid-way is supported — the loop stops at the first failed step.
  runStep: (stepKey: string) => Promise<StepRunResult>;
  // Fired after every step succeeds — typically a router.refresh().
  onDone?: () => void;
  // Button label on the destructive confirm button. Defaults to "Remove".
  confirmLabel?: string;
}

// Reusable confirm-then-progress modal. Mirrors the pattern in
// [[DeleteUserModal]] but is leaner — no type-to-confirm, parent-owned
// open state, and copy is fully customisable. Use this whenever a
// destructive action cascades through multiple steps and the admin
// benefits from seeing what's happening.
export function DeleteWithStepsModal({
  open,
  onClose,
  title,
  subtitle,
  bullets,
  steps,
  runStep,
  onDone,
  confirmLabel = "Remove",
}: DeleteWithStepsModalProps) {
  const [phase, setPhase] = useState<"confirm" | "running" | "done" | "failed">("confirm");
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, string>>({});

  const reset = () => {
    if (phase === "running") return;
    setPhase("confirm");
    setStatuses({});
    setErrors({});
    setDetails({});
    onClose();
  };

  const run = async () => {
    setPhase("running");
    const init: Record<string, StepStatus> = {};
    steps.forEach((s) => (init[s.key] = "queued"));
    setStatuses(init);

    let failed = false;
    for (const step of steps) {
      setStatuses((prev) => ({ ...prev, [step.key]: "running" }));
      const res = await runStep(step.key);
      if (res.ok) {
        setStatuses((prev) => ({ ...prev, [step.key]: "done" }));
        if (res.detail) setDetails((prev) => ({ ...prev, [step.key]: res.detail! }));
      } else {
        setStatuses((prev) => ({ ...prev, [step.key]: "failed" }));
        setErrors((prev) => ({ ...prev, [step.key]: res.error || "Failed" }));
        failed = true;
        break;
      }
    }
    setPhase(failed ? "failed" : "done");
    if (!failed) onDone?.();
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={reset}
      />
      <div className="fixed z-50 inset-2 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                {phase === "done" ? "Done" : phase === "failed" ? "Stopped" : title}
              </h2>
              {subtitle && <p className="text-[11px] text-gray-400">{subtitle}</p>}
            </div>
          </div>
          {phase !== "running" && (
            <button onClick={reset} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {phase === "confirm" && (
          <div className="p-6 space-y-4">
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 space-y-1.5">
              <p className="font-semibold">This will permanently delete:</p>
              <ul className="text-[12px] space-y-0.5 ml-5 list-disc">
                {bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
              <p className="text-[11px] text-red-600 dark:text-red-400 pt-1.5">This cannot be undone.</p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={run}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold cursor-pointer transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                {confirmLabel}
              </button>
              <button onClick={reset} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase !== "confirm" && (
          <>
            <div className="p-5 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                {steps.map((step) => {
                  const status = statuses[step.key] || "queued";
                  return (
                    <div
                      key={step.key}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                        status === "done"
                          ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
                          : status === "failed"
                            ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                            : status === "running"
                              ? "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800"
                              : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                        {status === "done" && (
                          <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {status === "failed" && (
                          <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        {status === "running" && <ButtonSpinner />}
                        {status === "queued" && (
                          <div className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium ${
                            status === "done"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : status === "failed"
                                ? "text-red-700 dark:text-red-300"
                                : status === "running"
                                  ? "text-indigo-700 dark:text-indigo-300"
                                  : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {step.label}
                          {details[step.key] && (
                            <span className="text-[11px] font-normal text-gray-400 ml-2">— {details[step.key]}</span>
                          )}
                        </p>
                        {errors[step.key] && (
                          <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">{errors[step.key]}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {phase === "done" && (
                <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
                  <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">All steps completed.</p>
                </div>
              )}

              {phase === "failed" && (
                <div className="mt-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-700 dark:text-red-300">Removal stopped at the failed step. Earlier steps that already completed cannot be undone.</p>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
              {phase === "running" ? (
                <span className="text-xs text-gray-400">Please wait — do not close this window.</span>
              ) : (
                <button onClick={reset} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
                  Close
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
