"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewCampaign } from "../actions";
import { ButtonSpinner } from "@/components/spinner";
import { useRole } from "@/components/role-context";

// Approve / reject controls for an under_review campaign, shown in the
// campaign detail header. Mirrors the small buttons on the list table but
// with room to surface the match count. Approve activates the campaign and
// fans out notifications to matching creators (handled in the edge fn).
export function CampaignReviewActions({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const { isAdmin } = useRole();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");

  if (!isAdmin) return null;

  const act = async (decision: "approve" | "reject") => {
    setPending(decision);
    setError("");
    const res = await reviewCampaign(campaignId, decision);
    if (res.error) {
      setError(res.error);
      setPending(null);
      return;
    }
    setPending(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="inline-flex items-center gap-2">
        <button
          onClick={() => act("approve")}
          disabled={!!pending}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white text-sm font-semibold cursor-pointer transition-colors"
        >
          {pending === "approve" ? <ButtonSpinner /> : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          Approve
        </button>
        <button
          onClick={() => act("reject")}
          disabled={!!pending}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 text-sm font-semibold cursor-pointer transition-colors"
        >
          {pending === "reject" && <ButtonSpinner />}
          Reject
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600 max-w-[220px] text-right">{error}</p>}
    </div>
  );
}
