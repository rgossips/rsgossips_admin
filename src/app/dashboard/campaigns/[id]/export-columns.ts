// Plain module (NOT "use server") — the row type and column spec for the
// applicants Excel export are shared by the server action and the client
// button, and a "use server" file may only export async functions.

export type ApplicantExportRow = {
  sno: number;
  name: string;
  instagram: string;
  instagramUrl: string;
  email: string;
  phone: string;
  followers: number | null;
  engagementRate: number | null;
  categories: string;
  location: string;
  // Barter fulfilment (migration 076). Empty on a campaign that ships
  // nothing, which is most of them.
  deliveryAddress: string;
  deliveryStatus: string;
  trackingUrl: string;
  gender: string;
  plan: string;
  status: string;
  initiatedBy: string;
  proposedRate: number | null;
  brandOfferedRate: number | null;
  finalAgreedRate: number | null;
  appliedOn: string;
  reason: string;
  submissionLinks: string;
  mediaKit: string;
};

// Sheet column order + header text + width (in characters).
export const APPLICANT_EXPORT_COLUMNS: { key: keyof ApplicantExportRow; header: string; width: number }[] = [
  { key: "sno", header: "S.No", width: 6 },
  { key: "name", header: "Name", width: 24 },
  { key: "instagram", header: "Instagram", width: 22 },
  { key: "instagramUrl", header: "Instagram URL", width: 34 },
  { key: "email", header: "Email", width: 28 },
  { key: "phone", header: "Phone", width: 16 },
  { key: "followers", header: "Followers", width: 12 },
  { key: "engagementRate", header: "Engagement Rate (%)", width: 18 },
  { key: "categories", header: "Categories", width: 28 },
  { key: "location", header: "Location", width: 22 },
  { key: "deliveryAddress", header: "Delivery Address", width: 40 },
  { key: "deliveryStatus", header: "Delivery Status", width: 18 },
  { key: "trackingUrl", header: "Tracking URL", width: 34 },
  { key: "gender", header: "Gender", width: 12 },
  { key: "plan", header: "Plan", width: 10 },
  { key: "status", header: "Application Status", width: 20 },
  { key: "initiatedBy", header: "Initiated By", width: 14 },
  { key: "proposedRate", header: "Proposed Rate (₹)", width: 16 },
  { key: "brandOfferedRate", header: "Brand Offered Rate (₹)", width: 20 },
  { key: "finalAgreedRate", header: "Final Agreed Rate (₹)", width: 20 },
  { key: "appliedOn", header: "Applied On", width: 14 },
  { key: "reason", header: "Rejection / Revision Note", width: 36 },
  { key: "submissionLinks", header: "Submission Links", width: 40 },
  { key: "mediaKit", header: "Media Kit", width: 34 },
];

// ── The campaign roster ──────────────────────────────────────────────────
//
// Everyone on the campaign, from BOTH intake paths: creators who applied
// through the portal and creators an admin sourced by hand. The applicant
// export above answers "who applied"; this answers "who is on this
// campaign", which is the question the slots line asks.
//
// Built ON the applicant columns rather than beside them so a column added
// there appears here too — two hand-kept lists is how the two files start
// disagreeing about what a creator's engagement rate is.

export type RosterExportRow = ApplicantExportRow & {
  /** Application, Outreach, or both — a creator can arrive by either. */
  source: string;
  /** Whether this row occupies one of the campaign's seats. */
  holdsSeat: string;
  /** Outreach pipeline stage, blank for an application-only row. */
  outreachStage: string;
  assignedTo: string;
  /** Rupees. Stored in paise on the booking — converted here, once. */
  quotedFee: number | null;
  agreedFee: number | null;
  outreachNotes: string;
};

const OUTREACH_COLUMNS: { key: keyof RosterExportRow; header: string; width: number }[] = [
  { key: "outreachStage", header: "Outreach Stage", width: 22 },
  { key: "assignedTo", header: "Assigned To", width: 20 },
  { key: "quotedFee", header: "Quoted Fee (₹)", width: 16 },
  { key: "agreedFee", header: "Agreed Fee (₹)", width: 16 },
  { key: "outreachNotes", header: "Outreach Notes", width: 40 },
];

// Source and seat first: they are what distinguishes this file from the
// applicant one, and what lets the reader reconcile it against the slots
// line by filtering "Holds Seat = Yes".
export const ROSTER_EXPORT_COLUMNS: { key: keyof RosterExportRow; header: string; width: number }[] = [
  { key: "sno", header: "S.No", width: 6 },
  { key: "source", header: "Source", width: 20 },
  { key: "holdsSeat", header: "Holds Seat", width: 11 },
  ...APPLICANT_EXPORT_COLUMNS.filter((c) => c.key !== "sno"),
  ...OUTREACH_COLUMNS,
];
