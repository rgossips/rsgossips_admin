// The HikerAPI client used by scouting.
//
// SERVER ONLY — it reads HIKER_API_KEY. Never import from a client component.
//
// There are two older call sites (influencers/enrich-actions.ts and
// sourcing/lookup-actions.ts) that each declare their own HIKER_BASE and
// call fetch directly. They are left alone deliberately: both work, both are
// exercised against live credits, and rewiring them to prove a point about
// tidiness would risk the enrichment for no behavioural gain. New code uses
// this.
//
// EVERY CALL HERE COSTS MONEY except getBalance(). The account is prepaid and
// the balance is small — 1,713 requests when this was written — so the number
// of requests a feature makes is a product decision, not an implementation
// detail. That is why the scouting UI shows the balance and states the cost
// of a run before it runs.

const HIKER_BASE = "https://api.hikerapi.com";

// Instagram lookups are slow; the existing enrichment sees 1–2s each. Netlify
// kills a function well before a hung socket would resolve on its own.
const TIMEOUT_MS = 20_000;

export type HikerResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

export function hikerConfigured(): boolean {
  return Boolean(process.env.HIKER_API_KEY);
}

async function hikerGet<T = unknown>(path: string, params: Record<string, string | number | undefined>): Promise<HikerResult<T>> {
  const apiKey = process.env.HIKER_API_KEY;
  if (!apiKey) return { ok: false, error: "HIKER_API_KEY is not configured on the server." };

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== "") qs.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${HIKER_BASE}${path}?${qs.toString()}`, {
      headers: { "x-access-key": apiKey, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      // 402 is the one worth naming: it means the prepaid balance ran out,
      // and "something went wrong" would send someone hunting a code bug.
      const msg =
        res.status === 402
          ? "HikerAPI balance exhausted — top up the account."
          : res.status === 429
            ? "HikerAPI rate limit hit. Wait a moment and try again."
            : `HikerAPI returned ${res.status}.`;
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: aborted ? "HikerAPI timed out." : "Could not reach HikerAPI." };
  } finally {
    clearTimeout(timer);
  }
}

export { hikerGet };

export type HikerBalance = { requests: number; amount: number; currency: string };

/**
 * Requests and money left. `/sys/balance` is free and NOT billed — which is
 * why the scouting page can show it on every load without the display itself
 * costing anything.
 */
export async function getBalance(): Promise<HikerResult<HikerBalance>> {
  const res = await hikerGet<Record<string, unknown>>("/sys/balance", {});
  if (!res.ok) return res;
  const d = res.data || {};
  return {
    ok: true,
    data: {
      requests: typeof d.requests === "number" ? d.requests : 0,
      amount: typeof d.amount === "number" ? d.amount : 0,
      currency: typeof d.currency === "string" ? d.currency : "USD",
    },
  };
}
