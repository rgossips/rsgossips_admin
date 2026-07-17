"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { adjustRc } from "../actions";

export function AdjustRcForm({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations("DashboardReferralsComponentsAdjustRcForm");
  const [username, setUsername] = useState("");
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
      setFeedback({ error: t("amountRequired") });
      return;
    }
    const delta = mode === "grant" ? abs : -abs;
    startSave(async () => {
      const res = await adjustRc(username.trim(), delta, note);
      if (res?.error) {
        setFeedback({ error: res.error });
        return;
      }
      setFeedback({
        ok: res.label
          ? t("adjustedFor", { label: res.label, balance: res.balanceAfter ?? 0 })
          : t("balanceAfter", { balance: res.balanceAfter ?? 0 }),
      });
      setAmount("");
      setNote("");
    });
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t("title")}
        </p>
        <p className="text-[12px] text-gray-400 mt-1">
          {t("description")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
        <div className="lg:col-span-2 flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 focus-within:ring-2 focus-within:ring-indigo-500">
          <span className="pl-3 pr-0.5 text-sm text-gray-400 select-none">@</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("usernamePlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 min-w-0 py-2 pr-3 bg-transparent text-sm outline-none font-mono"
          />
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
          className="px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm font-semibold"
        >
          <option value="grant">{t("grantOption")}</option>
          <option value="deduct">{t("deductOption")}</option>
        </select>
        <input
          type="number"
          min={1}
          max={10000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t("amountPlaceholder")}
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("reasonPlaceholder")}
        rows={2}
        maxLength={500}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-400">{note.length}/500 chars</p>
        <button
          type="button"
          onClick={submit}
          disabled={saving || !username.trim() || !amount || !note.trim()}
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
