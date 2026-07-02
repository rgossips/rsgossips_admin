"use client";

import { useState, useTransition } from "react";
import { adjustRc } from "../actions";

export function AdjustRcForm({ canWrite }: { canWrite: boolean }) {
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"grant" | "deduct">("grant");
  const [saving, startSave] = useTransition();
  const [feedback, setFeedback] = useState<{ ok?: string; error?: string } | null>(null);

  if (!canWrite) return null;

  const submit = () => {
    setFeedback(null);
    const abs = Math.trunc(Number(amount));
    if (!abs) {
      setFeedback({ error: "Amount is required" });
      return;
    }
    const delta = mode === "grant" ? abs : -abs;
    startSave(async () => {
      const res = await adjustRc(userId.trim(), delta, note);
      if (res?.error) {
        setFeedback({ error: res.error });
        return;
      }
      setFeedback({ ok: `Balance after: ${res.balanceAfter} RC` });
      setAmount("");
      setNote("");
    });
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Adjust RC wallet
        </p>
        <p className="text-[12px] text-gray-400 mt-1">
          Grant / deduct Reward Credits for any influencer. All adjustments are logged with your admin id.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Influencer user id"
          className="lg:col-span-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
          className="px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm font-semibold"
        >
          <option value="grant">Grant (+)</option>
          <option value="deduct">Deduct (−)</option>
        </select>
        <input
          type="number"
          min={1}
          max={10000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason (required — visible in audit log)"
        rows={2}
        maxLength={500}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-400">{note.length}/500 chars</p>
        <button
          type="button"
          onClick={submit}
          disabled={saving || !userId.trim() || !amount || !note.trim()}
          className={`px-4 py-2 rounded-lg text-white text-[12px] font-bold disabled:opacity-50 cursor-pointer ${
            mode === "grant" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          {saving ? "Saving…" : mode === "grant" ? "Grant RC" : "Deduct RC"}
        </button>
      </div>

      {feedback?.error && <p className="text-[12px] text-red-600">{feedback.error}</p>}
      {feedback?.ok && <p className="text-[12px] text-emerald-600">✓ {feedback.ok}</p>}
    </div>
  );
}
