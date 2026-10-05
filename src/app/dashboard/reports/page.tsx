import { createAdminClient } from "@/utils/supabase/admin";
import { ReportRow } from "./report-row";
import { SortMenu } from "@/components/sort-controls";
import { applySort, resolveSort, sortHref, type SortOption } from "@/lib/sorting";

export const dynamic = "force-dynamic";

// Moderation queue for content_reports.
//
// Play's UGC policy and Apple Guideline 1.2 require reports to be acted on.
// The app has had Report since the safety release; this is where they land.
//
// Oldest-first inside the open filter on purpose: a moderation queue worked
// newest-first quietly starves the oldest complaints, which is exactly the
// metric a store asks about.

const BASE = "/dashboard/reports";

// Moderation queue. Like payouts, each tab has its own natural default:
// the open queues are OLDEST first (the longest-waiting report is the most
// overdue) while Resolved is a history and reads newest-resolved first.
function reportSorts(): SortOption[] {
  const tiebreak = { column: "id", ascending: true };
  return [
    { key: "created", column: "created_at", label: "Reported", defaultDir: "asc", tiebreak },
    { key: "resolved", column: "resolved_at", label: "Resolved", defaultDir: "desc", nullsLast: true, tiebreak },
    { key: "reason", column: "reason", label: "Reason", defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "status", column: "status", label: "Status", defaultDir: "asc", tiebreak },
  ];
}

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "reviewing", label: "In review" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
] as const;

const REASON_LABEL: Record<string, string> = {
  spam: "Spam or misleading",
  harassment: "Harassment or bullying",
  hate_speech: "Hate speech",
  sexual_content: "Sexual or explicit content",
  violence: "Violence or threats",
  scam_or_fraud: "Scam or fraud",
  impersonation: "Impersonation",
  intellectual_property: "Copyright or trademark",
  other: "Other",
};

const STATUS_CLASS: Record<string, string> = {
  open: "bg-red-50 text-red-700",
  reviewing: "bg-amber-50 text-amber-700",
  actioned: "bg-emerald-50 text-emerald-700",
  dismissed: "bg-gray-100 text-gray-500",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; sort?: string }>;
}) {
  const sp = (await searchParams) || {};
  const filter = sp.status || "open";

  const db = createAdminClient();

  const SORTS = reportSorts();
  // The fallback follows the tab, so each one opens the way it did before
  // sorting existed; an explicit ?sort overrides either.
  const sort = resolveSort(sp.sort, SORTS, filter === "resolved" ? "resolved" : "created");

  let q = db.from("content_reports").select("*");
  if (filter === "open") q = q.eq("status", "open");
  else if (filter === "reviewing") q = q.eq("status", "reviewing");
  else if (filter === "resolved") q = q.in("status", ["actioned", "dismissed"]);
  q = applySort(q, sort);

  const { data: reports, error } = await q.limit(200);

  // Counts for the filter tabs. Head-only counts so this stays cheap as the
  // table grows.
  const [openCount, reviewingCount] = await Promise.all([
    db.from("content_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("content_reports").select("id", { count: "exact", head: true }).eq("status", "reviewing"),
  ]);

  // Resolve display names for reporters and reported parties in one pass.
  // The table stores only ids, and a queue of UUIDs cannot be moderated.
  const ids = Array.from(
    new Set((reports || []).flatMap((r) => [r.reporter_id, r.reported_user])),
  ).filter(Boolean);

  const names = new Map<string, string>();
  if (ids.length) {
    const [inf, brand] = await Promise.all([
      db.from("influencer_profiles").select("influencer_id, full_name, username").in("influencer_id", ids),
      db.from("brand_profiles").select("brand_id, brand_name").in("brand_id", ids),
    ]);
    for (const r of inf.data || []) names.set(r.influencer_id, r.full_name || r.username || "Creator");
    for (const r of brand.data || []) names.set(r.brand_id, r.brand_name || "Brand");
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          User reports of profiles, campaigns, pitches and deliverables. Both app stores require
          these to be reviewed and acted on.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count =
            f.id === "open" ? openCount.count : f.id === "reviewing" ? reviewingCount.count : null;
          return (
            <a
              key={f.id}
              href={sortHref(BASE, { ...sp, status: f.id }, sort.token)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
                active
                  ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {f.label}
              {count ? ` (${count})` : ""}
            </a>
          );
        })}
        {/* Always visible: this page has no table header to click. */}
        <SortMenu options={SORTS} current={sort} basePath={BASE} params={sp} className="ml-auto" />
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {!reports?.length ? (
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-16 text-center">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Nothing here</p>
          <p className="text-xs text-gray-500 mt-1">
            {filter === "open" ? "No open reports. Queue is clear." : "No reports match this filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportRow
              key={r.id}
              report={r}
              reporterName={names.get(r.reporter_id) || "Unknown"}
              reportedName={names.get(r.reported_user) || "Unknown"}
              reasonLabel={REASON_LABEL[r.reason] || r.reason}
              statusClass={STATUS_CLASS[r.status] || "bg-gray-100 text-gray-500"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
