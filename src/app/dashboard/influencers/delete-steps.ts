// Step metadata for the delete-influencer flow. Lives outside the
// "use server" actions file because Next.js wraps every export from a
// server-actions module as a server function — which means non-function
// exports get replaced with a callable reference on the client.
export const INFLUENCER_DELETE_STEPS = [
  // Must run before influencer_profile so we can still read their email.
  { key: "notify_user", label: "Notify creator by email" },
  { key: "creator_stories", label: "Creator stories" },
  { key: "featured_creators", label: "Featured creators listing" },
  { key: "campaign_applications", label: "Campaign applications" },
  { key: "service_orders", label: "Service orders & timeline events" },
  { key: "influencer_invitations", label: "Unlink claimed invitations" },
  { key: "influencer_profile", label: "Influencer profile" },
  { key: "auth_user", label: "Authentication (phone + Instagram tokens)" },
] as const;

export type InfluencerDeleteStepKey = (typeof INFLUENCER_DELETE_STEPS)[number]["key"];
