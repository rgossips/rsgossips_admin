// Badge colours for `campaign_applications.status`, shared by the campaign
// detail page's applications list and the influencer detail page's "Applied
// campaigns" card so the same status never renders in two different colours.
//
// Labels are NOT here: they live in the message catalog under
// `DashboardCampaignsIdApplications.status.*`, which both surfaces read.
export const APPLICATION_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
  // Kept for a decision later: a good applicant the campaign may still want,
  // parked without rejecting them. Violet rather than amber or red — to the
  // creator this is "shortlisted", which is good news, and the colour should
  // not read as a problem.
  on_hold: "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400",
  approved: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400",
  submitted: "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
  revision_needed: "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400",
  accepted: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
  live_submitted: "bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400",
  payment: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
  completed: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
  rejected: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400",
  // The campaign ended without a decision on this application. Slate, not
  // red: nobody judged this creator, so it must not look like a rejection
  // in a list they scroll past.
  closed: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
  withdrawn: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
};

// The badge dropdown on the campaign page offers exactly these, in this order
// — and `updateApplicationStatus` now validates against the same list, so a
// status an admin surface can set is always one every surface can render.
// That matters because the consumer app clamps an unrecognised status to the
// first rung of its ladder: a typo would quietly tell a creator "Applied"
// forever.
export const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS_BADGE);

export const isApplicationStatus = (v: unknown): boolean =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(APPLICATION_STATUS_BADGE, v);

export const applicationBadge = (status: string | null | undefined) =>
  APPLICATION_STATUS_BADGE[status || ""] || APPLICATION_STATUS_BADGE.withdrawn;
