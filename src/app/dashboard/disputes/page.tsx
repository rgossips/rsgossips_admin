import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { key: string; class: string }> = {
  disputed: { key: "disputed", class: "bg-red-50 text-red-700" },
  refunded: { key: "refunded", class: "bg-gray-100 text-gray-500" },
  released: { key: "released", class: "bg-emerald-50 text-emerald-700" },
};

const FILTERS = [
  { id: "disputed" },
  { id: "resolved" },
  { id: "all" },
];

const formatINR = (paise: number | null) =>
  paise == null ? "—" : "₹" + Math.round(paise / 100).toLocaleString("en-IN");
const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default async function DisputesPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const t = await getTranslations("DashboardDisputes");
  const sp = (await searchParams) || {};
  const filter = sp.status || "disputed";

  const admin = createAdminClient();
  let q = admin.from("escrow_disputes_v").select("*").order("dispute_opened_at", { ascending: false });

  if (filter === "disputed") q = q.eq("escrow_status", "disputed");
  else if (filter === "resolved") q = q.in("escrow_status", ["refunded", "released"]);

  const { data: disputes, error } = await q;

  // Counts for the filter tabs
  const { data: allRows } = await admin
    .from("escrow_disputes_v")
    .select("escrow_status");
  const counts = {
    disputed: (allRows || []).filter((r: any) => r.escrow_status === "disputed").length,
    resolved: (allRows || []).filter((r: any) => r.escrow_status !== "disputed").length,
    all: (allRows || []).length,
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = (counts as Record<string, number>)[f.id] ?? 0;
          return (
            <Link
              key={f.id}
              href={`/dashboard/disputes?status=${f.id}`}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                active
                  ? "bg-violet-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {t(`filters.${f.id}`)}
              <span className={`ml-2 text-xs ${active ? "opacity-80" : "opacity-60"}`}>{count}</span>
            </Link>
          );
        })}
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm mb-6">
          {t("loadError", { message: error.message })}
        </div>
      )}

      {!disputes || disputes.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center text-gray-400 text-sm">
          {t("empty")}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">{t("columns.campaign")}</th>
                <th className="px-4 py-3 text-left">{t("columns.brand")}</th>
                <th className="px-4 py-3 text-left">{t("columns.creator")}</th>
                <th className="px-4 py-3 text-right">{t("columns.amount")}</th>
                <th className="px-4 py-3 text-left">{t("columns.opened")}</th>
                <th className="px-4 py-3 text-left">{t("columns.status")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {disputes.map((d: any) => {
                const status = STATUS_LABEL[d.escrow_status] || STATUS_LABEL.disputed;
                return (
                  <tr key={d.application_id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{d.campaign_title || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{d.brand_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {d.influencer_name || (d.influencer_username ? `@${d.influencer_username}` : "—")}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">
                      {formatINR(d.escrow_amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDate(d.dispute_opened_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${status.class}`}>
                        {t(`status.${status.key}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/disputes/${d.application_id}`}
                        className="text-violet-600 hover:text-violet-700 font-semibold text-xs"
                      >
                        {t("review")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
