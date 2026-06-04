// Step metadata for the delete-brand flow. Lives outside the "use server"
// actions file — see the comment in influencers/delete-steps.ts.
export const BRAND_DELETE_STEPS = [
  { key: "campaign_applications", label: "Campaign applications" },
  { key: "campaigns", label: "Campaigns" },
  { key: "service_orders", label: "Service orders & timeline events" },
  { key: "brand_invitations", label: "Unlink claimed invitations" },
  { key: "brand_profile", label: "Brand profile" },
  { key: "auth_user", label: "Authentication (phone + Instagram tokens)" },
] as const;

export type BrandDeleteStepKey = (typeof BRAND_DELETE_STEPS)[number]["key"];
