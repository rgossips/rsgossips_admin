// Follower tiers.
//
// The add-creator form used to take `tier` as free text with the hint
// "Nano / Micro / Macro", so whatever an admin typed is what got stored —
// "micro", "Micro ", "mid-tier" and blank all appeared. It is derived from
// the follower count now, which is the thing the tier is a description OF.
//
// Plain module, not "use server": the form needs it as you type.
//
// The boundaries are the conventional scale, and they match the sheet names
// the agency workbooks arrive split by (see bulk-create.tsx). Upper bound is
// exclusive, so 10,000 followers is Micro and not Nano.

export const TIERS = ["Nano", "Micro", "Macro", "Celebrity"] as const;
export type Tier = (typeof TIERS)[number];

const BANDS: { tier: Tier; min: number; max: number | null }[] = [
  { tier: "Nano", min: 0, max: 10_000 },
  { tier: "Micro", min: 10_000, max: 100_000 },
  { tier: "Macro", min: 100_000, max: 1_000_000 },
  { tier: "Celebrity", min: 1_000_000, max: null },
];

/**
 * The tier a follower count falls in, or null when we have no usable count.
 *
 * Null rather than defaulting to "Nano": a creator we have no follower count
 * for is unknown, not small, and writing "Nano" onto them would be a claim
 * the data does not support — the same reason the match scorer separates
 * "miss" from "unknown".
 */
export function tierForFollowers(followers: unknown): Tier | null {
  const n = Number(followers);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const b of BANDS) {
    if (n >= b.min && (b.max === null || n < b.max)) return b.tier;
  }
  return null;
}

/** "10k – 100k", for showing beside the derived tier. */
export function tierRangeLabel(tier: Tier): string {
  const b = BANDS.find((x) => x.tier === tier);
  if (!b) return "";
  const fmt = (v: number) => (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1_000 ? `${v / 1_000}k` : String(v));
  return b.max === null ? `${fmt(b.min)}+` : `${fmt(b.min)} – ${fmt(b.max)}`;
}
