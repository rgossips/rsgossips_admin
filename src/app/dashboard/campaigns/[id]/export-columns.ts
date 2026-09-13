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
