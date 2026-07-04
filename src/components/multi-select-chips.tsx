"use client";

// Shared searchable multi-select chip picker. Used by
// invite-influencer-form + edit-influencer + anywhere else that needs
// a big-list chip picker (categories, languages, cities). Search box
// appears whenever `options.length > 20` so short lists don't get an
// awkward search bar they don't need.

import { useEffect, useRef, useState } from "react";

const inputClass =
  "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";
const labelClass =
  "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5";

export function MultiSelectChips({
  label,
  options,
  selected,
  onChange,
  required,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const q = search.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  return (
    <div ref={ref} className="relative">
      <label className={labelClass}>
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${inputClass} text-left flex items-center justify-between cursor-pointer`}
      >
        <span className={selected.length > 0 ? "text-gray-900 dark:text-white" : "text-gray-400"}>
          {selected.length > 0
            ? `${selected.length} selected`
            : `Select ${label.toLowerCase()}`}
        </span>
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[11px] font-semibold"
            >
              {v}
              <button
                type="button"
                onClick={() => toggle(v)}
                className="hover:text-indigo-800 cursor-pointer"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
          {options.length > 20 && (
            <div className="p-2 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="w-full px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-sm outline-none focus:border-indigo-400"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-center text-[12px] text-gray-400 py-6">
                No matches for &quot;{search}&quot;
              </p>
            ) : (
              filtered.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-700 dark:text-gray-300"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => toggle(opt)}
                    className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                  />
                  {opt}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
