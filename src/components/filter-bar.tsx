"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface FilterOption {
  label: string;
  value: string;
}

interface FilterField {
  name: string;
  label: string;
  type: "text" | "select" | "multiselect";
  placeholder?: string;
  options?: FilterOption[];
}

function DebouncedInput({
  name,
  placeholder,
  initialValue,
  onDebouncedChange,
}: {
  name: string;
  placeholder: string;
  initialValue: string;
  onDebouncedChange: (name: string, value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Hold the callback in a ref rather than depending on it. It's a
  // useCallback over `searchParams`, so its identity changes on EVERY
  // navigation — as an effect dep it re-armed the debounce after our own
  // push, which pushed again, and so on: an endless ?_rsc= refetch loop.
  const cbRef = useRef(onDebouncedChange);
  useEffect(() => {
    cbRef.current = onDebouncedChange;
  });

  // Sync when URL params change externally (e.g. clear filters)
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    // Already in sync with the URL, so there's nothing to push. This covers
    // the first render and — crucially — the settle after our own push, which
    // is what stops the loop rather than merely delaying it.
    if (value === initialValue) return;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      cbRef.current(name, value);
    }, 400);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [value, initialValue, name]);

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
    />
  );
}

function MultiSelectDropdown({
  field,
  selected,
  onChange,
}: {
  field: FilterField;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const t = useTranslations("FilterBar");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer min-w-[140px]"
      >
        <span className={selected.length > 0 ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}>
          {selected.length > 0 ? `${field.label} (${selected.length})` : field.label}
        </span>
        <svg className="w-4 h-4 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-56 max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
          {field.options?.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-700 dark:text-gray-300"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
              />
              {opt.label}
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border-t border-gray-100 dark:border-gray-700 cursor-pointer"
            >
              {t("clearSelection")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterBar({ fields }: { fields: FilterField[] }) {
  const t = useTranslations("FilterBar");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Navigate only when the query actually changes. Belt-and-braces against
  // the loop above, and it drops the stray trailing "?" that made the bare
  // path look like a distinct URL to the router.
  const pushParams = useCallback(
    (params: URLSearchParams) => {
      const next = params.toString();
      if (next === searchParams.toString()) return;
      router.push(next ? `${pathname}?${next}` : pathname);
    },
    [router, pathname, searchParams]
  );

  const updateFilter = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      pushParams(params);
    },
    [searchParams, pushParams]
  );

  const updateMultiFilter = useCallback(
    (name: string, values: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (values.length > 0) {
        params.set(name, values.join(","));
      } else {
        params.delete(name);
      }
      pushParams(params);
    },
    [searchParams, pushParams]
  );

  const clearAll = () => {
    router.push(pathname);
  };

  const hasFilters = fields.some((f) => searchParams.get(f.name));

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      {fields.map((field) =>
        field.type === "multiselect" ? (
          <MultiSelectDropdown
            key={field.name}
            field={field}
            selected={searchParams.get(field.name)?.split(",").filter(Boolean) || []}
            onChange={(values) => updateMultiFilter(field.name, values)}
          />
        ) : field.type === "select" ? (
          <select
            key={field.name}
            value={searchParams.get(field.name) || ""}
            onChange={(e) => updateFilter(field.name, e.target.value)}
            className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="">{field.label}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <DebouncedInput
            key={field.name}
            name={field.name}
            placeholder={field.placeholder || field.label}
            initialValue={searchParams.get(field.name) || ""}
            onDebouncedChange={updateFilter}
          />
        )
      )}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
        >
          {t("clearFilters")}
        </button>
      )}
    </div>
  );
}
