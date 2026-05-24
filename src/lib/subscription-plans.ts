// Mirrors the plans defined in the RGossips main app. Keep in sync.
export const SUBSCRIPTION_PLANS = [
  {
    key: "trial",
    label: "Trial (30 days)",
    description: "Elite features for 30 days. Reverts to Starter after trial.",
    color: "purple",
  },
  {
    key: "starter",
    label: "Starter",
    description: "₹99/mo · ₹899/yr — Get listed and start applying. Best for nano creators (1K–25K).",
    color: "gray",
  },
  {
    key: "pro",
    label: "Pro",
    description: "₹299/mo · ₹2,699/yr — Built to earn seriously. Best for micro/mid creators (10K–200K).",
    color: "indigo",
  },
  {
    key: "elite",
    label: "Elite",
    description: "₹699/mo · ₹6,299/yr — Pro-grade creator OS. Best for macro/mega creators (200K+).",
    color: "amber",
  },
] as const;

export type SubscriptionPlanKey = (typeof SUBSCRIPTION_PLANS)[number]["key"];

export const PLAN_BADGE_CLASS: Record<string, string> = {
  trial: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300",
  starter: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
  pro: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300",
  elite: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300",
};
