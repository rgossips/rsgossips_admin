// Badge colours for `campaign_applications.status`, shared by the campaign
// detail page's applications list and the influencer detail page's "Applied
// campaigns" card so the same status never renders in two different colours.
//
// Labels are NOT here: they live in the message catalog under
// `DashboardCampaignsIdApplications.status.*`, which both surfaces read.
export const APPLICATION_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
  approved: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400",
  submitted: "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
  revision_needed: "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400",
  accepted: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
  live_submitted: "bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400",
  payment: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
  completed: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
  rejected: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400",
  withdrawn: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
};

// The badge dropdown on the campaign page offers exactly these, in this order.
export const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS_BADGE);

export const applicationBadge = (status: string | null | undefined) =>
  APPLICATION_STATUS_BADGE[status || ""] || APPLICATION_STATUS_BADGE.withdrawn;
