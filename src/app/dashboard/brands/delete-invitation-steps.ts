// Step metadata for removing an invited-brand row. Kept out of the
// "use server" actions file because Next.js wraps every export from a
// server-actions module as a server function — non-function exports
// would get replaced with a callable reference on the client.
export const BRAND_INVITATION_DELETE_STEPS = [
  { key: "campaign_applications", label: "Applications on linked campaigns" },
  { key: "featured_campaigns", label: "Featured Campaigns listings" },
  { key: "campaigns", label: "Campaigns created for this brand" },
  { key: "invitation", label: "Invitation row" },
] as const;

export type BrandInvitationDeleteStepKey =
  (typeof BRAND_INVITATION_DELETE_STEPS)[number]["key"];
