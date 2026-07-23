import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusToggle } from "./_components/status-toggle";

export const dynamic = "force-dynamic";

const FILTERS = ["all", "open", "done"] as const;

type CallbackRow = {
  id: string;
  user_id: string;
  user_role: string | null;
  topic: string | null;
  topic_path: string | null;
  preferred_time: string | null;
  phone: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};

const ROLE_BADGE: Record<string, string> = {
  influencer:
    "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400",
  brand:
    "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
};

const formatDate = (iso: string) => {
  const dt = new Date(iso);
  return {
    day: dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    time: dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  };
};

export default async function CallbacksPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const t = await getTranslations("DashboardCallbacks");
  const sp = (await searchParams) || {};
  const filter = FILTERS.includes(sp.status as (typeof FILTERS)[number])
    ? (sp.status as (typeof FILTERS)[number])
    : "open";

  const admin = createAdminClient();
  const canWrite = await isAdminOrAbove();

  let q = admin
    .from("support_callbacks")
    .select("*")
    .order("created_at", { ascending: false });
  if (filter !== "all") q = q.eq("status", filter);

  const { data, error } = await q;
  const rows = (data || []) as CallbackRow[];

  // Requester display names — two batched lookups keyed by role, no N+1.
  const infIds = [
    ...new Set(rows.filter((r) => r.user_role === "influencer").map((r) => r.user_id)),
  ];
  const brandIds = [
    ...new Set(rows.filter((r) => r.user_role === "brand").map((r) => r.user_id)),
  ];
  const namesById: Record<string, string> = {};
  const [infRes, brandRes] = await Promise.all([
    infIds.length > 0
      ? admin
          .from("influencer_profiles")
          .select("influencer_id, full_name, username, instagram_handle")
          .in("influencer_id", infIds)
      : Promise.resolve({ data: [] as any[] }),
    brandIds.length > 0
      ? admin
          .from("brand_profiles")
          .select("brand_id, brand_name")
          .in("brand_id", brandIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  for (const i of infRes.data || []) {
    namesById[i.influencer_id] =
      i.full_name || i.username || (i.instagram_handle ? `@${i.instagram_handle}` : "");
  }
  for (const b of brandRes.data || []) {
    namesById[b.brand_id] = b.brand_name || "";
  }

  // Counts for the filter tabs (open drives the badge).
  const { data: allStatuses } = await admin
    .from("support_callbacks")
    .select("status");
  const openCount = (allStatuses || []).filter((r) => r.status === "open").length;
  const doneCount = (allStatuses || []).filter((r) => r.status === "done").length;
  const countFor = (f: string) =>
    f === "all" ? (allStatuses || []).length : f === "open" ? openCount : doneCount;

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={15000} />
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t("title")}
          {openCount > 0 && (
            <span className="ml-2 align-middle text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500 text-white">
              {t("openBadge", { count: openCount })}
            </span>
          )}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("description")}</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/dashboard/callbacks?status=${f}`}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 ${
              filter === f
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800"
            }`}
          >
            {t(`filters.${f}`)}
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                filter === f
                  ? "bg-white/20"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
              }`}
            >
              {countFor(f)}
            </span>
          </Link>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                {(["requester", "topic", "phone", "preferredTime", "notes", "requestedAt", "status"] as const).map((c) => (
                  <th
                    key={c}
                    className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-5 py-3.5"
                  >
                    {t(`columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty")}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const name = namesById[r.user_id] || t("unknownName");
                  const dt = formatDate(r.created_at);
                  const isOpen = r.status === "open";
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[180px]">
                          {name}
                        </p>
                        {r.user_role && (
                          <span
                            className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                              ROLE_BADGE[r.user_role] ||
                              "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                            }`}
                          >
                            {r.user_role === "influencer"
                              ? t("role.influencer")
                              : r.user_role === "brand"
                                ? t("role.brand")
                                : r.user_role}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm text-gray-900 dark:text-white">{r.topic || "—"}</p>
                        {r.topic_path && (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[220px]" title={r.topic_path}>
                            {r.topic_path}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {r.phone ? (
                          <a
                            href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
                            className="text-sm font-mono font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors whitespace-nowrap"
                          >
                            {r.phone}
                          </a>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {r.preferred_time || "—"}
                      </td>
                      <td className="px-5 py-4">
                        {r.notes ? (
                          <p className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-[220px]" title={r.notes}>
                            {r.notes}
                          </p>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <p className="text-[12px] text-gray-500 dark:text-gray-400">{dt.day}</p>
                        <p className="text-[10px] text-gray-400">{dt.time}</p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-3">
                          <span
                            className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                              isOpen
                                ? "bg-amber-50 text-amber-700"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {isOpen ? t("status.open") : t("status.done")}
                          </span>
                          <StatusToggle id={r.id} status={r.status} canWrite={canWrite} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
