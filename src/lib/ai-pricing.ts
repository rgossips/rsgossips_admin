// Per-model price map for the AI-usage COST ESTIMATE. Providers bill in USD
// per token, so prices are USD per 1,000,000 tokens, split input/output.
//
// These are approximate list prices and DRIFT over time — they're a starting
// point, not a source of truth. The admin can override any model's price from
// the AI Usage page; overrides are persisted in ai_config.model_pricing and
// take precedence over this map (see resolvePricing). Cost is always labelled
// "estimated" in the UI. Read real spend from each provider's own billing.

export type ModelPrice = { in: number; out: number }; // USD per 1M tokens

// Keys are the concrete model ids the ai-settings page offers (kept in sync
// with PROVIDER_MODELS there). An unknown model falls back to zero cost — its
// tokens still count, the spend just reads "—".
export const DEFAULT_MODEL_PRICING: Record<string, ModelPrice> = {
  // Anthropic
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-fable-5": { in: 3, out: 15 },
  // OpenAI
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  // Gemini
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gemini-1.5-pro": { in: 1.25, out: 5 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
};

// Merge stored overrides (from ai_config.model_pricing) over the defaults.
// Overrides win per-model; unknown/omitted models keep their default.
export function resolvePricing(
  overrides: Record<string, Partial<ModelPrice>> | null | undefined,
): Record<string, ModelPrice> {
  const merged: Record<string, ModelPrice> = { ...DEFAULT_MODEL_PRICING };
  if (overrides && typeof overrides === "object") {
    for (const [model, p] of Object.entries(overrides)) {
      if (!p) continue;
      const base = merged[model] || { in: 0, out: 0 };
      merged[model] = {
        in: Number.isFinite(p.in as number) ? (p.in as number) : base.in,
        out: Number.isFinite(p.out as number) ? (p.out as number) : base.out,
      };
    }
  }
  return merged;
}

// USD cost of a token bundle for one model. Unknown model → 0 (tokens still
// shown; only the dollar figure is unavailable).
export function costOf(
  model: string,
  tokensIn: number,
  tokensOut: number,
  pricing: Record<string, ModelPrice>,
): number {
  const p = pricing[model];
  if (!p) return 0;
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
}

export const formatUsd = (n: number): string =>
  n <= 0
    ? "—"
    : n < 0.01
      ? "<$0.01"
      : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
