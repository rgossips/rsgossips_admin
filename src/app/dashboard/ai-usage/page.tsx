import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { isSuperAdmin } from "@/lib/require-super-admin";
import { RefreshButton } from "@/components/refresh-button";
import { DEFAULT_MODEL_PRICING, resolvePricing, costOf, formatUsd, type ModelPrice } from "@/lib/ai-pricing";
import { PricingEditor } from "./pricing-editor";

export const dynamic = "force-dynamic";

type RollupRow = { provider: string; model: string; tool: string; gens: number; tokens_in: number; tokens_out: number };
type UserRow = { user_id: string | null; gens: number; tokens_in: number; tokens_out: number };

// Period presets -> [fromISO, toISO, label]. UTC month boundaries; events'
// created_at is UTC.
function periodRange(period: string): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthName = (yy: number, mm: number) =>
    new Date(Date.UTC(yy, mm, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  if (period === "prev") {
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    return { from: from.toISOString(), to: to.toISOString(), label: monthName(y, m - 1) };
  }
  if (period === "3m") {
    const from = new Date(Date.UTC(y, m - 2, 1));
    const to = new Date(Date.UTC(y, m + 1, 1));
    return { from: from.toISOString(), to: to.toISOString(), label: "Last 3 months" };
  }
  if (period === "all") {
    return { from: "1970-01-01T00:00:00Z", to: new Date(Date.UTC(y + 1, 0, 1)).toISOString(), label: "All time" };
  }
  // default: current month
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  return { from: from.toISOString(), to: to.toISOString(), label: monthName(y, m) };
}

const PERIODS = [
  { id: "current", label: "This month" },
  { id: "prev", label: "Last month" },
  { id: "3m", label: "Last 3 months" },
  { id: "all", label: "All time" },
];

const fmtInt = (n: number) => n.toLocaleString("en-IN");
const fmtTok = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  if (!(await isSuperAdmin())) redirect("/dashboard");

  const { period = "current" } = await searchParams;
  const { from, to, label } = periodRange(period);
  const admin = createAdminClient();

  // Pricing overrides live on the ai_config singleton.
  const { data: cfg } = await admin.from("ai_config").select("model_pricing").eq("id", 1).maybeSingle();
  const pricing = resolvePricing((cfg?.model_pricing as Record<string, Partial<ModelPrice>>) || {});

  // Aggregate server-side via the RPCs (migration 052). If they're absent —
  // migration not applied / edge fn not deployed yet — degrade to an empty
  // state rather than erroring.
  const [rollupRes, usersRes] = await Promise.all([
    admin.rpc("ai_usage_rollup", { p_from: from, p_to: to }),
    admin.rpc("ai_usage_by_user", { p_from: from, p_to: to, p_limit: 100 }),
  ]);

  const notDeployed = !!rollupRes.error;
  const rollup: RollupRow[] = (rollupRes.data as RollupRow[]) || [];
  const users: UserRow[] = (usersRes.data as UserRow[]) || [];

  // ---- Derive every breakdown from the compact rollup ----
  let totGens = 0, totIn = 0, totOut = 0, totCost = 0, totCostIn = 0, totCostOut = 0;
  const byProvider = new Map<string, { gens: number; tin: number; tout: number; cost: number }>();
  const byTool = new Map<string, { gens: number; tin: number; tout: number; cost: number }>();
  const byModel = new Map<string, { gens: number; tin: number; tout: number; cost: number }>();

  for (const r of rollup) {
    const p = pricing[r.model];
    const cIn = p ? (r.tokens_in / 1_000_000) * p.in : 0;
    const cOut = p ? (r.tokens_out / 1_000_000) * p.out : 0;
    const cost = cIn + cOut;
    totGens += r.gens; totIn += r.tokens_in; totOut += r.tokens_out;
    totCost += cost; totCostIn += cIn; totCostOut += cOut;

    const add = (map: Map<string, any>, key: string) => {
      const e = map.get(key) || { gens: 0, tin: 0, tout: 0, cost: 0 };
      e.gens += r.gens; e.tin += r.tokens_in; e.tout += r.tokens_out; e.cost += cost;
      map.set(key, e);
    };
    add(byProvider, r.provider);
    add(byTool, r.tool);
    add(byModel, r.model);
  }

  // Per-influencer cost is a blended estimate: distribute the period's total
  // in/out cost across creators proportionally to their in/out tokens (the
  // per-user rollup has no model dimension, by design). Sums back to ~total.
  const rateIn = totIn > 0 ? totCostIn / totIn : 0;
  const rateOut = totOut > 0 ? totCostOut / totOut : 0;

  // Resolve creator names for the top users.
  const ids = users.map((u) => u.user_id).filter((x): x is string => !!x);
  const nameMap = new Map<string, { name: string; handle: string }>();
  if (ids.length > 0) {
    const { data: profs } = await admin
      .from("influencer_profiles")
      .select("influencer_id, full_name, username, instagram_handle")
      .in("influencer_id", ids);
    for (const p of profs || []) {
      nameMap.set(p.influencer_id, {
        name: p.full_name || p.username || "Creator",
        handle: p.instagram_handle ? `@${p.instagram_handle}` : "",
      });
    }
  }

  const providerRows = [...byProvider.entries()].sort((a, b) => b[1].cost - a[1].cost || b[1].gens - a[1].gens);
  const toolRows = [...byTool.entries()].sort((a, b) => b[1].gens - a[1].gens);
  const modelRows = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Usage</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generation usage across the platform — by influencer, feature, and provider. Cost is estimated from token prices.
          </p>
        </div>
        <RefreshButton />
      </div>

      {/* Period tabs */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.id}
            href={`/dashboard/ai-usage?period=${p.id}`}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
              period === p.id
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            {p.label}
          </Link>
        ))}
        <span className="ml-auto self-center text-[12px] text-gray-400">{label}</span>
      </div>

      {notDeployed ? (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-5">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">AI usage tracking isn’t live yet</p>
          <p className="text-[13px] text-amber-700 dark:text-amber-400 mt-1">
            The <code>ai_usage_events</code> table / rollup functions (migration 052) aren’t in the database yet, or the
            <code> ai-generate</code> edge function hasn’t been redeployed to write them. Once both are in place, generations
            will start appearing here. Nothing is recorded retroactively.
          </p>
        </div>
      ) : totGens === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-400">
          No AI generations recorded for {label}.
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Generations" value={fmtInt(totGens)} />
            <Stat label="Input tokens" value={fmtTok(totIn)} />
            <Stat label="Output tokens" value={fmtTok(totOut)} />
            <Stat label="Est. cost" value={formatUsd(totCost)} accent="text-emerald-600 dark:text-emerald-400" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By provider */}
            <Panel title="By provider">
              <Table
                head={["Provider", "Gens", "Tokens", "Est. cost"]}
                rows={providerRows.map(([k, v]) => [
                  <span key="p" className="font-semibold capitalize">{k}</span>,
                  fmtInt(v.gens),
                  `${fmtTok(v.tin)} / ${fmtTok(v.tout)}`,
                  formatUsd(v.cost),
                ])}
              />
            </Panel>

            {/* By feature */}
            <Panel title="By feature (tool)">
              <Table
                head={["Feature", "Gens", "Tokens", "Est. cost"]}
                rows={toolRows.map(([k, v]) => [
                  <span key="t" className="font-mono text-[12px]">{k}</span>,
                  fmtInt(v.gens),
                  `${fmtTok(v.tin)} / ${fmtTok(v.tout)}`,
                  formatUsd(v.cost),
                ])}
              />
            </Panel>

            {/* By model */}
            <Panel title="By model">
              <Table
                head={["Model", "Gens", "Tokens", "Est. cost"]}
                rows={modelRows.map(([k, v]) => [
                  <span key="m" className="font-mono text-[11px]">{k}</span>,
                  fmtInt(v.gens),
                  `${fmtTok(v.tin)} / ${fmtTok(v.tout)}`,
                  formatUsd(v.cost),
                ])}
              />
            </Panel>

            {/* Top influencers */}
            <Panel title="Top influencers" subtitle="Ranked by generations · cost is a blended estimate">
              <Table
                head={["Influencer", "Gens", "Tokens", "Est. cost"]}
                rows={users.map((u) => {
                  const info = u.user_id ? nameMap.get(u.user_id) : null;
                  const cost = u.tokens_in * rateIn + u.tokens_out * rateOut;
                  return [
                    u.user_id ? (
                      <Link key="u" href={`/dashboard/influencers/${u.user_id}`} className="hover:text-indigo-600 hover:underline">
                        <span className="font-semibold">{info?.name || "Creator"}</span>
                        {info?.handle && <span className="text-gray-400 ml-1 text-[11px]">{info.handle}</span>}
                      </Link>
                    ) : (
                      <span key="u" className="text-gray-400 italic">deleted / unknown</span>
                    ),
                    fmtInt(u.gens),
                    `${fmtTok(u.tokens_in)} / ${fmtTok(u.tokens_out)}`,
                    formatUsd(cost),
                  ];
                })}
              />
            </Panel>
          </div>
        </>
      )}

      {/* Editable pricing (persisted to ai_config.model_pricing) */}
      <PricingEditor
        defaults={DEFAULT_MODEL_PRICING}
        overrides={(cfg?.model_pricing as Record<string, Partial<ModelPrice>>) || {}}
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent || "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    // min-w-0 lets this grid child shrink below its content width so the inner
    // overflow-x-auto actually scrolls instead of forcing the page wider.
    <div className="min-w-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  // min-w-full + nowrap cells: fills the panel when there's room, and when a
  // long value (e.g. a model id) exceeds it, the panel's overflow-x-auto
  // scrolls rather than the column wrapping or the page overflowing.
  return (
    <table className="min-w-full text-[13px]">
      <thead>
        <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-800">
          {head.map((h, i) => (
            <th key={i} className={`py-2 whitespace-nowrap ${i === 0 ? "pr-3" : "text-right pl-3"}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, ri) => (
          <tr key={ri} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
            {cells.map((c, ci) => (
              <td
                key={ci}
                className={`py-2 whitespace-nowrap text-gray-700 dark:text-gray-200 ${ci === 0 ? "pr-3" : "text-right tabular-nums pl-3"}`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
