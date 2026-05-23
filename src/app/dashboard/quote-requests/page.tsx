import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; class: string }> = {
  pending_quote: { label: "Awaiting quote", class: "bg-amber-50 text-amber-700" },
  quoted: { label: "Quote sent", class: "bg-indigo-50 text-indigo-700" },
  counter_offered: { label: "Counter offer", class: "bg-orange-50 text-orange-700" },
  declined: { label: "Declined", class: "bg-gray-100 text-gray-500" },
  expired: { label: "Expired", class: "bg-gray-100 text-gray-500" },
  paid_advance: { label: "Advance paid", class: "bg-emerald-50 text-emerald-700" },
  in_progress: { label: "In progress", class: "bg-violet-50 text-violet-700" },
  draft_ready: { label: "Draft ready", class: "bg-cyan-50 text-cyan-700" },
  revision_requested: { label: "Revision requested", class: "bg-orange-50 text-orange-700" },
  paid_final: { label: "Final paid", class: "bg-emerald-50 text-emerald-700" },
  completed: { label: "Completed", class: "bg-blue-50 text-blue-700" },
};

const FILTERS = [
  { id: "pending_quote", label: "Awaiting quote" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "declined", label: "Declined" },
  { id: "all", label: "All" },
];

export default async function QuoteRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const sp = (await searchParams) || {};
  const filter = sp.status || "pending_quote";

  const admin = createAdminClient();
  let q = admin
    .from("service_orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (filter === "active") {
    q = q.in("status", ["quoted", "paid_advance", "in_progress", "draft_ready", "revision_requested", "paid_final"]);
  } else if (filter === "completed") {
    q = q.eq("status", "completed");
  } else if (filter === "declined") {
    q = q.in("status", ["declined", "expired"]);
  } else if (filter === "pending_quote") {
    // Awaiting quote includes original requests + counter offers (both need admin action)
    q = q.in("status", ["pending_quote", "counter_offered"]);
  } else if (filter !== "all") {
    q = q.eq("status", filter);
  }

  const { data: orders, error } = await q;

  // For each row we want the requester's display name. Fetch in one shot.
  const userIds = Array.from(new Set((orders || []).map((o) => o.user_id))).filter(Boolean);
  let usersById: Record<string, { name: string; role: string }> = {};
  if (userIds.length > 0) {
    const [{ data: inf }, { data: br }] = await Promise.all([
      admin.from("influencer_profiles").select("influencer_id, full_name, username, instagram_handle").in("influencer_id", userIds),
      admin.from("brand_profiles").select("brand_id, brand_name").in("brand_id", userIds),
    ]);
    for (const i of inf || []) {
      usersById[i.influencer_id] = {
        name: i.full_name || i.username || (i.instagram_handle ? `@${i.instagram_handle}` : "Influencer"),
        role: "Influencer",
      };
    }
    for (const b of br || []) {
      usersById[b.brand_id] = { name: b.brand_name || "Brand", role: "Brand" };
    }
  }

  // Counts for nav
  const counts: Record<string, number> = {};
  const { data: allCounts } = await admin
    .from("service_orders")
    .select("status");
  for (const r of allCounts || []) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  const activeStatuses = new Set([
    "quoted",
    "paid_advance",
    "in_progress",
    "draft_ready",
    "revision_requested",
    "paid_final",
  ]);
  const countFor = (id: string) => {
    if (id === "active") return Object.entries(counts).reduce((s, [k, v]) => s + (activeStatuses.has(k) ? v : 0), 0);
    if (id === "declined") return (counts.declined || 0) + (counts.expired || 0);
    if (id === "pending_quote") return (counts.pending_quote || 0) + (counts.counter_offered || 0);
    if (id === "all") return Object.values(counts).reduce((s, v) => s + v, 0);
    return counts[id] || 0;
  };

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={15000} />
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Quote requests</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Influencer-submitted briefs. Open one to send a quote, decline, or follow the order through delivery.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/dashboard/quote-requests?status=${f.id}`}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 ${
              filter === f.id
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800"
            }`}
          >
            {f.label}
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                filter === f.id ? "bg-white/20" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
              }`}
            >
              {countFor(f.id)}
            </span>
          </Link>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(orders || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            Nothing in this view yet.
          </div>
        ) : (
          (orders || []).map((o) => {
            const u = usersById[o.user_id] || { name: "Unknown", role: "" };
            const st = STATUS_LABEL[o.status] || { label: o.status, class: "bg-gray-100 text-gray-500" };
            const dt = new Date(o.created_at);
            return (
              <Link
                key={o.id}
                href={`/dashboard/quote-requests/${o.id}`}
                className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="shrink-0 w-24 text-[12px] font-mono text-gray-400">{o.order_number}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{o.service_title}</p>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {u.name} · {u.role}
                    {o.scope ? ` · ${o.scope}` : ""}
                  </p>
                </div>
                <div className="hidden sm:block text-right shrink-0">
                  <p className="text-[12px] text-gray-500 dark:text-gray-400">
                    {dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${st.class}`}
                >
                  {st.label}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
