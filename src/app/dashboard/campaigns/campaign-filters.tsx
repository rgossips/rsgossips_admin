"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useEffect, useRef, useCallback } from "react";

import { CATEGORIES } from "@/lib/categories";

const STATUS_OPTIONS = [
  { key: "all", value: "" },
  { key: "draft", value: "draft" },
  { key: "underReview", value: "under_review" },
  { key: "active", value: "active" },
  // Derived sub-state of active: still live but past its application deadline.
  // The page resolves this to status=active AND application_deadline < now.
  { key: "appsClosed", value: "apps_closed" },
  { key: "paused", value: "paused" },
  { key: "completed", value: "completed" },
];

export function CampaignFilters() {
  const t = useTranslations("DashboardCampaignsCampaignFilters");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get("search") || "";
  const currentStatus = searchParams.get("status") || "";
  const currentCategories = searchParams.get("category")?.split(",").filter(Boolean) || [];

  const [search, setSearch] = useState(currentSearch);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [modalCategories, setModalCategories] = useState<string[]>(currentCategories);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      router.push(pathname + "?" + params.toString());
    },
    [router, pathname, searchParams]
  );

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      if (search !== currentSearch) {
        updateParams({ search });
      }
    }, 400);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [search, currentSearch, updateParams]);

  const toggleCategory = (cat: string) => {
    const next = currentCategories.includes(cat)
      ? currentCategories.filter((c) => c !== cat)
      : [...currentCategories, cat];
    updateParams({ category: next.join(",") });
  };

  const activeFilterCount =
    currentCategories.length + (currentStatus ? 1 : 0);

  // Quick categories shown as chips (first 4)
  const quickCategories = CATEGORIES.slice(0, 4);

  return (
    <>
      <div className="space-y-4 mb-6">
        {/* Row 1: Search + Filter button */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
            />
          </div>
          <button
            onClick={() => {
              setModalCategories(currentCategories);
              setShowFilterModal(true);
            }}
            className="relative flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            {t("allFilters")}
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Row 2: Status tabs */}
        <div className="flex items-center gap-6">
          <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl gap-0.5">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateParams({ status: opt.value })}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentStatus === opt.value
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-200/50 dark:shadow-indigo-900/40"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t(`status.${opt.key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Row 3: Category chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mr-1">
            {t("category")}
          </span>
          <button
            onClick={() => updateParams({ category: "" })}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
              currentCategories.length === 0
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {t("all")}
          </button>
          {quickCategories.map((cat) => {
            const isActive = currentCategories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {cat}
              </button>
            );
          })}
          {currentCategories.filter((c) => !quickCategories.includes(c)).length > 0 && (
            <span className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
              {t("moreCount", {
                count: currentCategories.filter((c) => !quickCategories.includes(c)).length,
              })}
            </span>
          )}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setSearch("");
                router.push(pathname);
              }}
              className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer font-medium"
            >
              {t("resetAll")}
            </button>
          )}
        </div>
      </div>

      {/* Filter Modal */}
      {showFilterModal && (
        <FilterModal
          categories={modalCategories}
          setCategories={setModalCategories}
          currentStatus={currentStatus}
          onApply={(cats: string[], status: string) => {
            const params = new URLSearchParams(searchParams.toString());
            if (cats.length > 0) {
              params.set("category", cats.join(","));
            } else {
              params.delete("category");
            }
            if (status) {
              params.set("status", status);
            } else {
              params.delete("status");
            }
            router.push(pathname + "?" + params.toString());
            setShowFilterModal(false);
          }}
          onClose={() => setShowFilterModal(false)}
        />
      )}
    </>
  );
}

function FilterModal({
  categories,
  setCategories,
  currentStatus,
  onApply,
  onClose,
}: {
  categories: string[];
  setCategories: (c: string[]) => void;
  currentStatus: string;
  onApply: (categories: string[], status: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("DashboardCampaignsCampaignFilters");
  const [status, setStatus] = useState(currentStatus);
  const modalRef = useRef<HTMLDivElement>(null);

  const toggleCategory = (cat: string) => {
    if (cat === "All") {
      setCategories([]);
    } else {
      setCategories(
        categories.includes(cat) ? categories.filter((c) => c !== cat) : [...categories, cat]
      );
    }
  };

  const handleReset = () => {
    setCategories([]);
    setStatus("");
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="fixed z-50 inset-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-2xl lg:max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl lg:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("filters")}</h2>
          <button
            onClick={handleReset}
            className="text-xs font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
          >
            {t("reset")}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Category */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{t("category")}</h3>
              {categories.length > 0 && (
                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                  {t("selectedCount", { count: categories.length })}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toggleCategory("All")}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer border ${
                  categories.length === 0
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {t("all")}
              </button>
              {CATEGORIES.map((cat) => {
                const isActive = categories.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer border ${
                      isActive
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Status */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{t("statusLabel")}</h3>
            <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    status === opt.value
                      ? "bg-indigo-600 text-white shadow-md"
                      : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  }`}
                >
                  {t(`status.${opt.key}`)}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-gray-800 p-6 flex gap-3">
          <button
            onClick={handleReset}
            className="flex-1 py-3.5 rounded-2xl font-bold text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-all cursor-pointer"
          >
            {t("reset")}
          </button>
          <button
            onClick={() => onApply(categories, status)}
            className="flex-1 py-3.5 rounded-2xl font-bold text-white text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-200/50 dark:shadow-indigo-900/30 transition-all cursor-pointer"
          >
            {t("applyFilters")}
          </button>
        </div>
      </div>
    </>
  );
}
