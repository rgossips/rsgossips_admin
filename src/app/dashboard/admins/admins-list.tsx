"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminRow } from "./admin-row";
import { compareBy } from "@/lib/sorting";

// Sorting here is CLIENT-side, unlike every other list page, because the
// filters on this page already are: the admin team is small enough that
// going to the server per keystroke was the source of real lag (see the
// comment below). Putting the sort in the URL instead would mean a round
// trip for something the browser already holds in full.
type SortKey = "name" | "email" | "role" | "status" | "added";
const SORT_VALUE: Record<SortKey, (a: AdminWithAuth) => string | number> = {
  name: (a) => a.full_name || "",
  email: (a) => a.email || "",
  role: (a) => a.role || "",
  // Derived, not stored: "accepted" means they have signed in at least once.
  status: (a) => (a.pendingSetup ? 2 : a.lastSignInAt ? 0 : 1),
  added: (a) => a.created_at || "",
};
const SORT_COLUMNS: { key: SortKey; labelKey: string }[] = [
  { key: "name", labelKey: "colName" },
  { key: "email", labelKey: "colEmail" },
  { key: "role", labelKey: "colRole" },
  { key: "status", labelKey: "colStatus" },
  { key: "added", labelKey: "colAdded" },
];

interface AdminWithAuth {
  id: string;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  pendingSetup: boolean;
}

// Client-side filtering for the admins page. The full list is small (admin
// team, not end users) so filtering in the browser feels instant — the
// previous approach hit the server + `auth.admin.listUsers` on every
// keystroke, which was the source of the lag.
export function AdminsList({
  admins,
  currentUserId,
}: {
  admins: AdminWithAuth[];
  currentUserId: string;
}) {
  const t = useTranslations("DashboardAdminsAdminsList");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  // Added-ascending is what the page showed before sorting existed.
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [sortAsc, setSortAsc] = useState(true);
  // useDeferredValue lets the input stay snappy even on slower devices.
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    return admins.filter((a) => {
      if (role && a.role !== role) return false;
      if (needle) {
        const haystack = `${a.full_name} ${a.email}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [admins, deferredSearch, role]);

  const sorted = useMemo(
    () => compareBy(filtered, SORT_VALUE[sortKey], sortAsc),
    [filtered, sortKey, sortAsc],
  );

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc((v) => !v);
      return;
    }
    setSortKey(key);
    // Names and emails read better A-Z; a date reads better newest first.
    setSortAsc(key !== "added");
  };

  const hasFilters = !!search || !!role;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="">{t("roleAll")}</option>
          <option value="super_admin">{t("roleSuperAdmin")}</option>
          <option value="admin">{t("roleAdmin")}</option>
          <option value="viewer">{t("roleViewer")}</option>
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setSearch("");
              setRole("");
            }}
            className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-180">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              {SORT_COLUMNS.map((col) => {
                const active = col.key === sortKey;
                return (
                  <th key={col.key} className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`group inline-flex items-center gap-1 cursor-pointer ${active ? "text-gray-900 dark:text-white" : "hover:text-gray-700 dark:hover:text-gray-200"}`}
                    >
                      <span className={active ? "font-bold" : ""}>{t(col.labelKey)}</span>
                      <svg
                        className={`h-3.5 w-3.5 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-gray-600"}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d={(active ? sortAsc : col.key !== "added") ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
                        />
                      </svg>
                    </button>
                  </th>
                );
              })}
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {sorted.length > 0 ? (
              sorted.map((a) => (
                <AdminRow
                  key={a.id}
                  admin={a}
                  isSuperAdmin
                  isCurrentUser={a.id === currentUserId}
                  lastSignInAt={a.lastSignInAt}
                  emailConfirmedAt={a.emailConfirmedAt}
                  pendingSetup={a.pendingSetup}
                />
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                  {t("noResults")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
