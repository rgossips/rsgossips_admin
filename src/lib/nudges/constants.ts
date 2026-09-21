// Creator nudges — the catalogue. Plain module (no server imports) so the
// page, the client component and the server code share one list.
//
// Eligibility rules live in segments.ts, copy in templates.ts. Adding a nudge
// means a key here, a rule there and a template there.

export const NUDGE_KEYS = ["a1", "a2", "a3", "b1", "b2", "c1", "c2", "c3"] as const;
export type NudgeKey = (typeof NUDGE_KEYS)[number];

export const isNudgeKey = (v: unknown): v is NudgeKey =>
  typeof v === "string" && (NUDGE_KEYS as readonly string[]).includes(v);

export type NudgeGroup = "subscribe" | "inactive" | "other";

export const NUDGES: Record<NudgeKey, { group: NudgeGroup; label: string; rule: string }> = {
  a1: {
    group: "subscribe",
    label: "1 · What's inside",
    rule: "Not subscribed, signed up at least 1 day ago.",
  },
  a2: {
    group: "subscribe",
    label: "2 · What a plan unlocks",
    rule: "Not subscribed, signed up at least 3 days ago, email 1 sent at least 2 days ago.",
  },
  a3: {
    group: "subscribe",
    label: "3 · Save with annual",
    rule: "Not subscribed, signed up at least 7 days ago, email 2 sent at least 3 days ago.",
  },
  b1: {
    group: "inactive",
    label: "1 · What you missed",
    rule: "Hasn't opened the app for 2+ days. Once per quiet spell.",
  },
  b2: {
    group: "inactive",
    label: "2 · Keep your profile fresh",
    rule: "Still quiet 7+ days, 'What you missed' sent at least 3 days ago in this spell.",
  },
  c1: {
    group: "other",
    label: "Free applications used up",
    rule: "Not subscribed and has applied to 3+ campaigns (the free limit).",
  },
  c2: {
    group: "other",
    label: "Profile incomplete",
    rule: "No categories or no bio, signed up at least 1 day ago.",
  },
  c3: {
    group: "other",
    label: "Instagram needs attention",
    rule: "Insights not granted (partial), connection broken, or never connected. Repeats at most weekly until fixed.",
  },
};

/** c3 repeats while the Instagram problem lasts, but no more often than this. */
export const INSTAGRAM_NUDGE_REPEAT_DAYS = 7;

export const NUDGE_GROUPS: { key: NudgeGroup; title: string; blurb: string }[] = [
  { key: "subscribe", title: "Signed up, not subscribed", blurb: "A 3-email sequence. Each one unlocks after the previous." },
  { key: "inactive", title: "Hasn't checked in", blurb: "For creators who haven't opened RGossips in 2+ days." },
  { key: "other", title: "Other pushes", blurb: "High-intent moments." },
];

// Automatic runs send at most one nudge per creator, in this order —
// the highest-intent message wins when several apply.
export const AUTO_PRIORITY: NudgeKey[] = ["c1", "c3", "a3", "a2", "a1", "b2", "b1", "c2"];

/** No creator gets more than one nudge (of any kind) inside this window. */
export const NUDGE_COOLDOWN_HOURS = 48;

/** Recipients per manual send request (client-chunked, like bulk invite). */
export const NUDGE_CHUNK_SIZE = 10;

/** Recipients per automatic run (hourly), so a run fits a function timeout. */
export const AUTO_RUN_LIMIT = 30;

/** Automatic runs only send inside these IST hours (10:00–19:59). */
export const AUTO_HOURS_IST = { from: 10, to: 20 };

/** Lifetime free barter applications — mirrors rgossips_web plans.js. */
export const FREE_APPLICATIONS = 3;
