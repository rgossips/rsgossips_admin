"use client";

import { useState, useTransition } from "react";
import { setFeaturedSectionTitle } from "../actions";

// Small inline editor for the influencer-home section title. Renders
// read-only label + Edit button by default; flips to text input + Save
// on click. Limits length to 80 chars (server enforces the same).

export function SectionTitleEditor({ initialTitle, canWrite }: { initialTitle: string; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await setFeaturedSectionTitle(value);
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
        Section title (influencer home)
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
              Edit
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={80}
            placeholder="Plan your stay with us"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-gray-400">{value.length}/80</span>
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
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !value.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold disabled:opacity-50 cursor-pointer"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
