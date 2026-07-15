"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

// Generic inline editor for an admin-editable string (used for the
// influencer-home section titles backed by public.homepage_settings).
// Renders a read-only label with an Edit button; flips to a text input +
// Save/Cancel when clicked. The caller supplies the save server action,
// which receives the new value and returns `{ ok? } | { error? }`.

export function SectionTitleEditor({
  initialTitle,
  canWrite,
  label,
  placeholder,
  maxLength = 80,
  onSave,
}: {
  initialTitle: string;
  canWrite: boolean;
  label: string;
  placeholder?: string;
  maxLength?: number;
  onSave: (value: string) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const t = useTranslations("SectionTitleEditor");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await onSave(value);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setSavedTitle(value);
      setEditing(false);
    });
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        {label}
      </p>
      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-bold text-gray-900 dark:text-white">{savedTitle}</p>
          {canWrite && (
            <button
              type="button"
              onClick={() => {
                setValue(savedTitle);
                setEditing(true);
              }}
              className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              {t("edit")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={maxLength}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-gray-400">{value.length}/{maxLength}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setValue(savedTitle);
                }}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !value.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold disabled:opacity-50 cursor-pointer"
              >
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
