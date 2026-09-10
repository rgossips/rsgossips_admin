// Mirrors the plans defined in the RGossips main app (`src/lib/plans.js`).
// Keep in sync — the consumer app is the authority on what a plan grants.
//
// Entitlement lives in TWO columns on `influencer_profiles`:
//   subscription_plan — "starter" | "pro" | "elite" (the tier)
//   billing_cycle     — "monthly" | "annual"
// A tier without a cycle is only half a plan: the consumer app's renewal
// countdown reads billing_cycle, so writing one without the other shows a
// 30-day countdown to someone on an annual plan. Hence the six options.
//
// "trial"/"free" are legacy values still present on old rows (the column
// defaults to 'trial'). They are DISPLAYABLE but not SETTABLE: the consumer
// app's getEffectivePlan() only honours starter/pro/elite, so writing
// "trial" from here grants nothing to any account older than 30 days.

export const BILLING_CYCLES = ["monthly", "annual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_TIERS = [
  {
    key: "starter",
    label: "Starter",
    description: "Get listed and start applying. Best for nano creators (1K–25K).",
    pricing: { monthly: "₹99/mo", annual: "₹899/yr" },
  },
  {
    key: "pro",
    label: "Pro",
    description: "Built to earn seriously. Best for micro/mid creators (10K–200K).",
    pricing: { monthly: "₹299/mo", annual: "₹2,699/yr" },
  },
  {
    key: "elite",
    label: "Elite",
    description: "Pro-grade creator OS. Best for macro/mega creators (200K+).",
    pricing: { monthly: "₹699/mo", annual: "₹6,299/yr" },
  },
] as const;

export type SubscriptionPlanKey = (typeof SUBSCRIPTION_TIERS)[number]["key"];

// The six settable (tier, cycle) combinations — one per Razorpay plan id.
export const SUBSCRIPTION_PLAN_OPTIONS = SUBSCRIPTION_TIERS.flatMap((tier) =>
  BILLING_CYCLES.map((cycle) => ({
    id: `${tier.key}_${cycle}`,
    plan: tier.key as SubscriptionPlanKey,
    cycle,
    label: tier.label,
    price: tier.pricing[cycle],
  })),
);

export const VALID_PLAN_KEYS = new Set<string>(SUBSCRIPTION_TIERS.map((p) => p.key));
export const VALID_BILLING_CYCLES = new Set<string>(BILLING_CYCLES);

// Legacy values kept for rendering the CURRENT badge on old rows only.
export const PLAN_BADGE_CLASS: Record<string, string> = {
  trial: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300",
  free: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
  starter: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
  pro: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300",
  elite: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300",
};

export const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  elite: "Elite",
};

// Tier ordering — MUST match PLAN_RANK in the consumer app's plans.js.
export const PLAN_RANK: Record<string, number> = { starter: 1, pro: 2, elite: 3 };

// Minimum tier per media-kit template — MUST match MEDIA_KIT_TEMPLATES in
// the consumer app's plans.js. bento_sunset / neo_brutalist are ELITE-only
// there; this map used to say "pro", which left an Elite→Pro downgrade
// holding a template the creator's own app then refused to save.
export const TEMPLATE_MIN_PLAN: Record<string, string> = {
  classic: "starter",
  glass_blue: "pro",
  editorial_noir: "pro",
  bento_sunset: "elite",
  neo_brutalist: "elite",
};
