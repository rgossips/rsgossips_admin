"use client";

import { useState } from "react";
import Link from "next/link";
import { toggleInfluencerStatus } from "./actions";
import { Avatar } from "@/components/avatar";
import { useRole } from "@/components/role-context";

interface Influencer {
  influencer_id: string;
  full_name: string | null;
  username: string | null;
  profile_photo_url: string | null;
  followers_count: number | null;
  categories: string[] | null;
  status: string | null;
}

export function InfluencerRow({ inf, phone }: { inf: Influencer; phone?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(inf.status);
  const { isAdmin } = useRole();

  const handleToggle = async () => {
    const action = status === "active" ? "suspend" : "reactivate";
    if (!confirm(`Are you sure you want to ${action} ${inf.full_name || inf.username}?`)) return;

    setLoading(true);
    const result = await toggleInfluencerStatus(inf.influencer_id, status || "");
    if (result.error) {
      alert(result.error);
    } else {
      setStatus(result.newStatus ?? status);
    }
    setLoading(false);
  };

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="px-6 py-4">
        <Link
          href={`/dashboard/influencers/${inf.influencer_id}`}
          className="flex items-center gap-3 group"
        >
          <Avatar src={inf.profile_photo_url} name={inf.full_name} size="sm" shape="circle" />
          <span className="text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
            {inf.full_name || "—"}
          </span>
        </Link>
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        {inf.username || "—"}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 font-mono">
        {phone ? (
          <a href={`tel:${phone}`} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
            {phone.startsWith("+") ? phone : `+${phone}`}
          </a>
        ) : (
          <span className="text-gray-400 dark:text-gray-600">—</span>
        )}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        {inf.followers_count?.toLocaleString() ?? "—"}
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-1">
          {inf.categories && inf.categories.length > 0 ? (
            inf.categories.slice(0, 3).map((cat) => (
              <span
                key={cat}
                className="inline-flex px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              >
                {cat}
              </span>
            ))
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
          {inf.categories && inf.categories.length > 3 && (
            <span className="text-xs text-gray-400">+{inf.categories.length - 3}</span>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <span
          className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
            status === "active"
              ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
              : status === "suspended"
              ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
              : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
          }`}
        >
          {status || "unknown"}
        </span>
      </td>
      <td className="px-6 py-4">
        {isAdmin ? (
        <button
          onClick={handleToggle}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border ${
            status === "active"
              ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40"
              : "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
          }`}
        >
          {loading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : status === "active" ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {loading
            ? "Processing..."
            : status === "active"
            ? "Suspend"
            : "Reactivate"}
        </button>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
        )}
      </td>
    </tr>
  );
}
