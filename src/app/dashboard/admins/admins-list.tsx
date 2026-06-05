"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { AdminRow } from "./admin-row";

interface AdminWithAuth {
  id: string;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
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
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
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

  const hasFilters = !!search || !!role;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setSearch("");
              setRole("");
            }}
            className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">Name</th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">Email</th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">Role</th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">Status</th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">Added</th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {filtered.length > 0 ? (
              filtered.map((a) => (
                <AdminRow
                  key={a.id}
                  admin={a}
                  isSuperAdmin
                  isCurrentUser={a.id === currentUserId}
                  lastSignInAt={a.lastSignInAt}
                  emailConfirmedAt={a.emailConfirmedAt}
                />
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                  No admin users match these filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
