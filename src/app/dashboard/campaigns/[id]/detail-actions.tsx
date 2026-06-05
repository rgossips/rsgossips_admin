"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCampaignStatus } from "../actions";
import { ButtonSpinner } from "@/components/spinner";

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
] as const;

// Styling for each status — keep in sync with the badge colors used on
// the list/detail pages so the dropdown reads as the same affordance.
const statusStyle: Record<string, string> = {
  draft: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  active: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  paused: "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  completed: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
};

// Free-form status changer. Replaces the older one-shot buttons so the
// admin can move to any state (e.g. revert a completed campaign back to
// active if it was marked done by mistake). We optimistically update the
// local select value and roll back if the server action rejects, so the
// UI stays responsive without a full router refresh just to flip a badge.
export function CampaignDetailActions({
  campaignId,
  status,
}: {
  campaignId: string;
  status: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [loading, setLoading] = useState(false);

  const handleChange = async (next: string) => {
    if (next === current) return;

    // Soft confirm only for terminal transitions where it matters.
    const isCompleting = next === "completed";
    if (isCompleting && !confirm("Mark this campaign as completed? Applications won't change but the campaign will no longer accept new ones.")) {
      return;
    }

    const prev = current;
    setCurrent(next);
    setLoading(true);
    const result = await updateCampaignStatus(campaignId, next);
    setLoading(false);
    if (result.error) {
      setCurrent(prev);
      alert(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="inline-flex items-center gap-2 shrink-0">
      <label className="sr-only" htmlFor="campaign-status-select">Campaign status</label>
      <div className={`relative inline-flex items-center rounded-xl border ${statusStyle[current] || statusStyle.draft}`}>
        <select
          id="campaign-status-select"
          value={current}
          onChange={(e) => handleChange(e.target.value)}
          disabled={loading}
          className="appearance-none bg-transparent text-sm font-semibold pl-4 pr-9 py-2.5 cursor-pointer focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              {s.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3">
          {loading ? (
            <ButtonSpinner />
          ) : (
            <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </span>
      </div>
    </div>
  );
}
