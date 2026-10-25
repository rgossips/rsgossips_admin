// Plain module (NOT "use server"): the column catalogue is shared by the
// server action and the client dialog, and a "use server" file may only
// export async functions.

export type InfluencerExportRow = Record<string, string | number | null>;

export type ExportColumn = {
  key: string;
  header: string;
  width: number;
  /** Ticked when the dialog opens. */
  byDefault: boolean;
  /** Email, phone and location. Flagged so the dialog can say so. */
  sensitive?: boolean;
};

/**
 * Everything that can go in the sheet.
 *
 * Order here is the order in the file, so a column added in the middle
 * moves the ones after it — which is fine, because the header row names
 * each one and nothing downstream reads this by position.
 *
 * `byDefault` is the judgement call worth stating: the default selection is
 * what someone needs to RECOGNISE and CONTACT a creator, because that is
 * what almost every export is for. Everything else is available and off,
 * so the common download is not 20 columns wide.
 */
export const INFLUENCER_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "sno", header: "S.No", width: 6, byDefault: true },
  { key: "fullName", header: "Name", width: 24, byDefault: true },
  { key: "username", header: "Username", width: 20, byDefault: false },
  { key: "instagram", header: "Instagram", width: 22, byDefault: true },
  { key: "instagramUrl", header: "Instagram URL", width: 34, byDefault: false },
  { key: "email", header: "Email", width: 28, byDefault: true, sensitive: true },
  { key: "phone", header: "Phone", width: 16, byDefault: true, sensitive: true },
  { key: "followers", header: "Followers", width: 12, byDefault: true },
  { key: "engagementRate", header: "Engagement Rate (%)", width: 18, byDefault: true },
  { key: "categories", header: "Categories", width: 28, byDefault: true },
  { key: "languages", header: "Languages", width: 22, byDefault: false },
  { key: "location", header: "Location", width: 22, byDefault: true, sensitive: true },
  { key: "gender", header: "Gender", width: 12, byDefault: false },
  { key: "plan", header: "Plan", width: 12, byDefault: false },
  { key: "billingCycle", header: "Billing Cycle", width: 14, byDefault: false },
  { key: "paymentGateway", header: "Payment Source", width: 16, byDefault: false },
  { key: "status", header: "Status", width: 14, byDefault: false },
  { key: "igStatus", header: "IG Status", width: 18, byDefault: false },
  { key: "mediaKit", header: "Media Kit", width: 34, byDefault: false },
  { key: "joinedOn", header: "Joined On", width: 14, byDefault: false },
];

export const DEFAULT_EXPORT_KEYS = INFLUENCER_EXPORT_COLUMNS.filter((c) => c.byDefault).map(
  (c) => c.key,
);

/** Keys that carry personal contact data, for the dialog's warning. */
export const SENSITIVE_EXPORT_KEYS = INFLUENCER_EXPORT_COLUMNS.filter((c) => c.sensitive).map(
  (c) => c.key,
);

/**
 * Hard cap on one download.
 *
 * There are ~540 registered creators today, so this is headroom rather
 * than a limit anyone meets. It exists because the action pages the whole
 * result set into memory, and an unbounded export is how a Netlify
 * function dies quietly at some future row count.
 */
export const EXPORT_MAX_ROWS = 5000;

/** PostgREST will not return more than this in one request. */
export const EXPORT_PAGE_SIZE = 1000;
