"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteCampaigns } from "./actions";
import { useRole } from "@/components/role-context";
import { ConfirmDialog, useConfirmDialog } from "@/components/confirm-dialog";
import { ButtonSpinner } from "@/components/spinner";

interface Campaign {
  campaign_id: string;
  title: string | null;
  status: string | null;
  max_influencers: number | null;
  campaign_start_date: string | null;
  campaign_end_date: string | null;
  target_categories: string[] | null;
  brand_id: string | null;
  brand_invitation_id: string | null;
  created_by_admin: boolean | null;
  brand_profiles: { brand_name: string | null } | null;
  brand_invitations: { brand_name: string | null } | null;
}

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  active: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
  paused: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
  completed: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Client-side wrapper around the campaigns table. Adds:
//  - a checkbox column visible to super-admins
//  - a sticky bulk action bar that surfaces a Delete CTA when ≥1 row is
//    selected (calls [[deleteCampaigns]], super-admin gated server-side)
// Non-super-admins see exactly the table they saw before (no checkboxes,
// no action bar), so the UI doesn't suggest an action they can't perform.
export function CampaignsTable({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const { isSuperAdmin } = useRole();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const confirmDelete = useConfirmDialog();

  const allIds = useMemo(() => campaigns.map((c) => c.campaign_id), [campaigns]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && selected.size < allIds.length;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    confirmDelete.ask({
      title: `Delete ${ids.length} campaign${ids.length === 1 ? "" : "s"}?`,
      description:
        "This permanently removes the selected campaigns, all of their applications, and any featured-campaign listings. This cannot be undone.",
      confirmLabel: `Delete ${ids.length}`,
      cancelLabel: "Cancel",
      variant: "danger",
      handler: async () => {
        setError("");
        const result = await new Promise<{ error?: string; deleted?: number }>((resolve) => {
          startTransition(async () => {
            const r = await deleteCampaigns(ids);
            resolve(r);
          });
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        clearSelection();
        router.refresh();
      },
    });
  };

  const showChecks = isSuperAdmin;
  const colSpan = showChecks ? 6 : 5;

  return (
    <>
      <ConfirmDialog {...confirmDelete.dialogProps} />

      {showChecks && selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-lg shadow-gray-900/20">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold">{selected.size} selected</span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs opacity-70 hover:opacity-100 underline cursor-pointer"
            >
              Clear
            </button>
          </div>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-red-300 text-white text-sm font-semibold cursor-pointer transition-colors disabled:cursor-not-allowed"
          >
            {pending ? <ButtonSpinner /> : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
            {pending ? "Deleting…" : `Delete ${selected.size}`}
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 mb-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 text-sm">{error}</div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
              {showChecks && (
                <th className="w-10 px-4 py-3.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    aria-label="Select all"
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
              )}
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">Title</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">Brand</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">Status</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">Slots</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">Dates</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {campaigns.length > 0 ? (
              campaigns.map((campaign) => (
                <Row
                  key={campaign.campaign_id}
                  campaign={campaign}
                  showCheck={showChecks}
                  checked={selected.has(campaign.campaign_id)}
                  onToggle={() => toggleOne(campaign.campaign_id)}
                />
              ))
            ) : (
              <tr>
                <td colSpan={colSpan} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No campaigns found</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Try adjusting your filters or create a new campaign</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({
  campaign,
  showCheck,
  checked,
  onToggle,
}: {
  campaign: Campaign;
  showCheck: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const brandName = campaign.brand_profiles?.brand_name || campaign.brand_invitations?.brand_name || "—";
  const status = campaign.status || "draft";
  return (
    <tr className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${checked ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""}`}>
      {showCheck && (
        <td className="px-4 py-4">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`Select ${campaign.title || "campaign"}`}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
        </td>
      )}
      <td className="px-6 py-4">
        <Link href={`/dashboard/campaigns/${campaign.campaign_id}`} className="text-sm text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">
          {campaign.title || "—"}
        </Link>
        {campaign.target_categories && campaign.target_categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {campaign.target_categories.map((cat) => (
              <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">{cat}</span>
            ))}
          </div>
        )}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        {brandName}
        {campaign.brand_invitation_id && !campaign.brand_id && (
          <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-semibold">Invited</span>
        )}
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || statusColors.draft}`}>
          {status}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        {campaign.max_influencers ?? "—"}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        <div>{formatDate(campaign.campaign_start_date)}</div>
        {campaign.campaign_end_date && (
          <div className="text-xs text-gray-400">to {formatDate(campaign.campaign_end_date)}</div>
        )}
      </td>
    </tr>
  );
}
