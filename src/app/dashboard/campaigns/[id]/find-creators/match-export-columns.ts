// Plain module, NOT "use server": read by the client download button, and
// kept out of match-actions.ts because a "use server" file may only export
// async functions — a catalogue exported from one becomes a callable ref.

export type MatchExportColumn = { key: string; header: string; width: number };

/**
 * The matching sheet.
 *
 * Order here is the order in the file. Nothing downstream reads it by
 * position, so inserting a column in the middle is safe.
 *
 * `Message` carries the filled outreach note and `DM Link` the composer
 * URL, for the same reason the scouting sheet does: the point of most runs
 * is to hand the file to whoever is doing the messaging, and they should
 * never have to open the portal.
 *
 * `Match` and `Why` come along because the rows are RANKED — a sheet that
 * dropped the score would arrive in an order the recipient could not
 * account for.
 */
export const MATCH_EXPORT_COLUMNS: MatchExportColumn[] = [
  { key: "sno", header: "S.No", width: 6 },
  { key: "handle", header: "Instagram", width: 24 },
  { key: "name", header: "Name", width: 26 },
  { key: "tier", header: "Tier", width: 11 },
  { key: "followers", header: "Followers", width: 12 },
  { key: "engagement", header: "ER %", width: 8 },
  { key: "city", header: "City", width: 22 },
  { key: "categories", header: "Categories", width: 30 },
  { key: "gender", header: "Gender", width: 14 },
  { key: "email", header: "Email", width: 28 },
  { key: "source", header: "In Our Database", width: 18 },
  // Whether we have already invited them to this campaign. Here because the
  // sheet is what gets handed to whoever does the outreach, and the one
  // thing they must not do is contact somebody we contacted yesterday.
  { key: "invited", header: "Invited On", width: 14 },
  { key: "match", header: "Match", width: 8 },
  { key: "why", header: "Why", width: 40 },
  { key: "campaign", header: "Campaign", width: 28 },
  { key: "profileUrl", header: "Profile URL", width: 34 },
  { key: "dmUrl", header: "DM Link", width: 30 },
  { key: "message", header: "Message", width: 60 },
];
