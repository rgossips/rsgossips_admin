"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export function ResolveActions({
  applicationId,
  amount,
}: {
  applicationId: string;
  amount: number | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<"refund" | "release" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<"refund" | "release" | null>(null);
  const [note, setNote] = useState("");

  const amountInr = amount ? Math.round(amount / 100).toLocaleString("en-IN") : "—";

  const resolve = async (decision: "refund_brand" | "release_to_creator") => {
    setBusy(decision === "refund_brand" ? "refund" : "release");
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke("admin-escrow-resolve", {
      body: { applicationId, decision, note: note || undefined },
    });
    if (invokeErr || data?.error) {
      setError(invokeErr?.message || data?.error || "Failed to resolve");
      setBusy(null);
      return;
    }
    router.refresh();
  };

  if (confirmFor) {
    const isRefund = confirmFor === "refund";
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-900 dark:text-white font-semibold">
          {isRefund
            ? `Refund ₹${amountInr} back to the brand?`
            : `Release ₹${amountInr} to the creator?`}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {isRefund
            ? "Razorpay will refund the original payment to the brand's card/UPI. This usually settles within 5–7 working days."
            : "The payout will be queued on RazorpayX and fired by the next cron tick (within 15 minutes)."}
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional internal note"
          rows={2}
          className="w-full p-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-900 outline-none focus:ring-2 focus:ring-violet-200"
        />
        {error && (
          <p className="text-xs text-red-600 font-semibold">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            disabled={busy !== null}
            onClick={() => resolve(isRefund ? "refund_brand" : "release_to_creator")}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${
              isRefund ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {busy === (isRefund ? "refund" : "release") ? "Working…" : "Confirm"}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => {
              setConfirmFor(null);
              setError(null);
              setNote("");
            }}
            className="px-3 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setConfirmFor("release")}
        className="w-full px-3 py-2 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700"
      >
        Release ₹{amountInr} to creator
      </button>
      <button
        onClick={() => setConfirmFor("refund")}
        className="w-full px-3 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700"
      >
        Refund ₹{amountInr} to brand
      </button>
    </div>
  );
}
