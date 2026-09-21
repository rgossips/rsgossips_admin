// Brand vs agency — the admin-set label on brand_profiles.account_type and
// brand_invitations.account_type (RS_Gossips migration 075). Plain module so
// client badges and server pages share it.
//
// The Brands and Campaigns lists filter by it via the `btype` URL param
// (comma list). Both or neither selected = no filter.

export const BRAND_ACCOUNT_TYPES = ["brand", "agency"] as const;
export type BrandAccountType = (typeof BRAND_ACCOUNT_TYPES)[number];

export const BRAND_TYPE_PARAM = "btype";

export const isBrandAccountType = (v: unknown): v is BrandAccountType =>
  typeof v === "string" && (BRAND_ACCOUNT_TYPES as readonly string[]).includes(v);

/** Missing / unknown values read as "brand" — the column default. */
export const toBrandAccountType = (v: unknown): BrandAccountType => (v === "agency" ? "agency" : "brand");

/** The one type to filter to, or null when the filter is off (none or both ticked). */
export function brandTypeFilter(raw: string | null | undefined): BrandAccountType | null {
  const picked = new Set((raw || "").split(",").filter(isBrandAccountType));
  return picked.size === 1 ? [...picked][0] : null;
}
