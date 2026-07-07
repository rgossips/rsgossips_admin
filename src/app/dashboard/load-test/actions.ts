"use server";

// Load-test runner — hits the READ-ONLY edge functions on the live
// Supabase project from the admin server (service-role key never
// reaches the browser). Super-admin only, with hard caps on
// concurrency and iterations so a fat-fingered config can't hammer
// production. No OTP sends, no writes, no payments — read paths only.

import { requireSuperAdmin } from "@/lib/require-super-admin";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// The only endpoints the runner is allowed to touch. Each entry is a
// fixed function + body — the client picks scenarios by id, never by
// arbitrary URL, so this can't be repurposed to POST anywhere else.
const SCENARIOS: Record<string, { label: string; fn: string; body: Record<string, unknown> }> = {
  influencers_page: {
    label: "list-influencers — page of 50, no filters",
    fn: "list-influencers",
    body: { limit: 50, offset: 0 },
  },
  influencers_filtered: {
    label: "list-influencers — search + category filter",
    fn: "list-influencers",
    body: { limit: 50, offset: 0, q: "a", filters: { categories: ["Travel & Hospitality"] }, sort: "followers_desc" },
  },
  campaigns_discovery: {
    label: "list-campaigns — influencer discovery",
    fn: "list-campaigns",
    body: {},
  },
  featured_campaigns: {
    label: "list-featured-campaigns — landing carousel",
    fn: "list-featured-campaigns",
    body: {},
  },
};

// Hard ceilings. 20×20 = max 400 requests per scenario per run.
const MAX_VUS = 20;
const MAX_ITERATIONS = 20;

export type ScenarioResult = {
  id: string;
  label: string;
  total: number;
  ok: number;
  errors: number;
  rps: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  avgKB: number | null;
};

function pct(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function runScenario(
  id: string,
  vus: number,
  iterations: number,
): Promise<ScenarioResult> {
  const s = SCENARIOS[id];
  const latencies: number[] = [];
  let errors = 0;
  let bytes = 0;

  const vu = async () => {
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${SUPA_URL}/functions/v1/${s.fn}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify(s.body),
          cache: "no-store",
        });
        const text = await res.text();
        bytes += text.length;
        const ms = performance.now() - t0;
        if (!res.ok) errors++;
        else {
          try {
            const j = JSON.parse(text);
            if (j?.error) errors++;
            else latencies.push(ms);
          } catch {
            errors++;
          }
        }
      } catch {
        errors++;
      }
    }
  };

  const t0 = performance.now();
  await Promise.all(Array.from({ length: vus }, vu));
  const wallSec = (performance.now() - t0) / 1000;

  latencies.sort((a, b) => a - b);
  const total = vus * iterations;
  const ok = latencies.length;
  return {
    id,
    label: s.label,
    total,
    ok,
    errors,
    rps: Number((ok / wallSec).toFixed(1)),
    p50: ok ? Math.round(pct(latencies, 50)) : null,
    p95: ok ? Math.round(pct(latencies, 95)) : null,
    max: ok ? Math.round(latencies[ok - 1]) : null,
    avgKB: total ? Math.round(bytes / total / 1024) : null,
  };
}

export async function runLoadTest(input: {
  scenarioIds: string[];
  vus: number;
  iterations: number;
}): Promise<{ error?: string; results?: ScenarioResult[]; ranAt?: string }> {
  try {
    await requireSuperAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const vus = Math.max(1, Math.min(MAX_VUS, Math.trunc(Number(input.vus) || 0)));
  const iterations = Math.max(1, Math.min(MAX_ITERATIONS, Math.trunc(Number(input.iterations) || 0)));
  const ids = (input.scenarioIds || []).filter((id) => SCENARIOS[id]);
  if (ids.length === 0) return { error: "Pick at least one scenario" };

  // Scenarios run SEQUENTIALLY so concurrency never exceeds `vus` —
  // running them in parallel would multiply load by the scenario count.
  const results: ScenarioResult[] = [];
  for (const id of ids) {
    results.push(await runScenario(id, vus, iterations));
  }

  return { results, ranAt: new Date().toISOString() };
}

export async function getScenarioCatalog(): Promise<{ id: string; label: string }[]> {
  return Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label }));
}
