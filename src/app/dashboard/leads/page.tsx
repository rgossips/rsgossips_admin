import { createAdminClient } from "@/utils/supabase/admin";
import { FilterBar } from "@/components/filter-bar";
import { RefreshButton } from "@/components/refresh-button";
import { getTranslations } from "next-intl/server";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const t = await getTranslations("DashboardLeads");
  const { search, role, source } = await searchParams;
  const supabase = createAdminClient();

  let query = supabase.from("leads").select("*").order("last_attempt_at", { ascending: false });

  if (search) query = query.ilike("phone", `%${search}%`);
  if (role) query = query.eq("role_attempted", role);
  if (source) query = query.eq("source", source);

  const { data: leads, error } = await query;

  // Distinct values for filter dropdowns
  const { data: allLeads } = await supabase.from("leads").select("role_attempted, source");
  const roleSet = new Set<string>();
  const sourceSet = new Set<string>();
  (allLeads || []).forEach((l: { role_attempted: string | null; source: string | null }) => {
    if (l.role_attempted) roleSet.add(l.role_attempted);
    if (l.source) sourceSet.add(l.source);
  });

  const filterFields = [
    { name: "search", label: t("filters.searchPhone"), type: "text" as const, placeholder: t("filters.searchPhonePlaceholder") },
    {
      name: "role",
      label: t("filters.allRoles"),
      type: "select" as const,
      options: Array.from(roleSet).sort().map((r) => ({ label: r.charAt(0).toUpperCase() + r.slice(1), value: r })),
    },
    {
      name: "source",
      label: t("filters.allSources"),
      type: "select" as const,
      options: Array.from(sourceSet).sort().map((s) => ({ label: s.replace(/_/g, " "), value: s })),
    },
  ];

  const formatPhone = (p: string) => {
    // Format Indian numbers as +91 XXXXX XXXXX
    if (p.length === 12 && p.startsWith("91")) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
    if (p.length === 10) return `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
    return `+${p}`;
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const roleBadge: Record<string, string> = {
    influencer: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400",
    brand: "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">{t("subtitle")}</p>
        </div>
        <RefreshButton />
      </div>

      <FilterBar fields={filterFields} />

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
          {t("loadError", { message: error.message })}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{t("leadCount", { count: leads?.length ?? 0 })}</span>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full min-w-180">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.phone")}</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.roleAttempted")}</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.source")}</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.attempts")}</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.lastAttempt")}</th>
              <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest px-6 py-3.5">{t("columns.firstSeen")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {leads && leads.length > 0 ? (
              leads.map((lead: { phone: string; role_attempted: string | null; source: string | null; attempts: number | null; last_attempt_at: string | null; created_at: string | null }) => (
                <tr key={lead.phone} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                        <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                      </div>
                      <a href={`tel:+${lead.phone}`} className="text-sm font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-mono">
                        {formatPhone(lead.phone)}
                      </a>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {lead.role_attempted ? (
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${roleBadge[lead.role_attempted] || "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}>
                        {lead.role_attempted}
                      </span>
                    ) : <span className="text-sm text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                    {lead.source ? <span className="capitalize">{lead.source.replace(/_/g, " ")}</span> : "—"}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
                      (lead.attempts ?? 0) > 3
                        ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                    }`}>
                      {lead.attempts ?? 0}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{formatDate(lead.last_attempt_at)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{formatDate(lead.created_at)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-16 text-center">
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
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
