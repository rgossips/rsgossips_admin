import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { AdjustRcForm } from "./_components/adjust-rc-form";
import { resolveManualReview } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, { label: string; class: string }> = {
  PENDING: { label: "Pending", class: "bg-slate-100 text-slate-500" },
  SIGNED_UP: { label: "Signed up", class: "bg-blue-50 text-blue-700" },
  QUALIFIED: { label: "Qualified", class: "bg-amber-50 text-amber-700" },
  REWARDED: { label: "Rewarded", class: "bg-emerald-50 text-emerald-700" },
  REVERSED: { label: "Reversed", class: "bg-rose-50 text-rose-600" },
  EXPIRED: { label: "Expired", class: "bg-slate-100 text-slate-400" },
  MANUAL_REVIEW: { label: "Under review", class: "bg-orange-50 text-orange-700" },
};

const FILTERS = [
  { id: "review", label: "Manual review" },
  { id: "rewarded", label: "Rewarded" },
  { id: "signed_up", label: "Signed up" },
  { id: "all", label: "All" },
];

const formatDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const sp = (await searchParams) || {};
  const filter = sp.status || "review";
  const admin = createAdminClient();
  const canWrite = await isAdminOrAbove();

  let q = admin
    .from("referrals")
    .select("id, referrer_id, referee_id, referral_code, status, referee_first_plan, referrer_reward_rc, created_at, qualified_at, rewarded_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter === "review") q = q.eq("status", "MANUAL_REVIEW");
  else if (filter === "rewarded") q = q.eq("status", "REWARDED");
  else if (filter === "signed_up") q = q.in("status", ["PENDING", "SIGNED_UP"]);

  const { data: rows, error } = await q;

  // Bulk look up referrer / referee names.
  const userIds = new Set<string>();
  (rows || []).forEach((r: any) => {
    if (r.referrer_id) userIds.add(r.referrer_id);
    if (r.referee_id) userIds.add(r.referee_id);
  });
  const names = new Map<string, { name: string; handle?: string }>();
  if (userIds.size > 0) {
    const { data: infs } = await admin
      .from("influencer_profiles")
      .select("influencer_id, full_name, username, instagram_handle")
      .in("influencer_id", [...userIds]);
    (infs || []).forEach((i: any) => {
      names.set(i.influencer_id, {
        name: i.full_name || i.username || "Unknown",
        handle: i.instagram_handle,
      });
    });
  }

  // Simple KPI counts for the top strip.
  const { data: allRows } = await admin.from("referrals").select("status");
  const statuses = (allRows || []).map((r: any) => r.status);
  const counts = {
    total: statuses.length,
    rewarded: statuses.filter((s) => s === "REWARDED").length,
    signed_up: statuses.filter((s) => s === "PENDING" || s === "SIGNED_UP").length,
    review: statuses.filter((s) => s === "MANUAL_REVIEW").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Refer & Earn</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Influencer referrals + Reward Credits wallet. Manual reviews land here when a referrer hits the daily cap or an anti-fraud rule fires.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatPill label="Total" value={counts.total} />
        <StatPill label="Rewarded" value={counts.rewarded} accent="text-emerald-600" />
        <StatPill label="In-flight" value={counts.signed_up} accent="text-blue-600" />
        <StatPill label="Under review" value={counts.review} accent="text-orange-600" />
      </div>

      <AdjustRcForm canWrite={canWrite} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <a
              key={f.id}
              href={`?status=${f.id}`}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                active
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {f.label}
            </a>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        {(rows || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">No referrals in this state.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {(rows || []).map((r: any) => {
              const pill = STATUS_PILL[r.status] || { label: r.status, class: "bg-slate-100" };
              const referrer = names.get(r.referrer_id);
              const referee = r.referee_id ? names.get(r.referee_id) : null;
              return (
                <div key={r.id} className="p-4 grid grid-cols-12 gap-3 items-start">
                  <div className="col-span-4">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Referrer</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{referrer?.name || "—"}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {referrer?.handle ? `@${referrer.handle}` : "—"}
                    </p>
                    <p className="text-[11px] text-gray-400 font-mono truncate">Code: {r.referral_code}</p>
                  </div>

                  <div className="col-span-4">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Referee</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                      {referee?.name || "(not signed up)"}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {referee?.handle ? `@${referee.handle}` : "—"}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {r.referee_first_plan ? `First plan: ${r.referee_first_plan}` : "No plan yet"}
                    </p>
                  </div>

                  <div className="col-span-2">
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${pill.class}`}>
                      {pill.label}
                    </span>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {formatDate(r.rewarded_at || r.qualified_at || r.created_at)}
                    </p>
                    {r.referrer_reward_rc > 0 && (
                      <p className="text-[13px] font-black text-emerald-600 mt-1">+{r.referrer_reward_rc} RC</p>
                    )}
                  </div>

                  <div className="col-span-2 flex flex-col gap-2">
                    {r.status === "MANUAL_REVIEW" && canWrite && (
                      <>
                        <form
                          action={async () => {
                            "use server";
                            await resolveManualReview(r.id, "approve");
                          }}
                        >
                          <button
                            type="submit"
                            className="w-full px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold cursor-pointer"
                          >
                            Approve
                          </button>
                        </form>
                        <form
                          action={async () => {
                            "use server";
                            await resolveManualReview(r.id, "reject");
                          }}
                        >
                          <button
                            type="submit"
                            className="w-full px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 text-[12px] font-bold cursor-pointer"
                          >
                            Reject
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent || "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}
