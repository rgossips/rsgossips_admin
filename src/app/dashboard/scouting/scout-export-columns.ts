// Plain module, NOT "use server": shared by the client download button and
// read by nothing on the server, but kept apart from scout-actions.ts for the
// same reason every other catalogue is — a "use server" file may only export
// async functions.

export type ScoutExportColumn = { key: string; header: string; width: number };

/**
 * The scouting sheet.
 *
 * Order here is the order in the file. The header row names every column and
 * nothing downstream reads this by position, so inserting one in the middle
 * is safe.
 *
 * `Message` carries the filled outreach note. That is the point of the sheet
 * for most runs: hand it to whoever is doing the messaging and they never
 * have to open the portal, which is also why `DM Link` is a column rather
 * than only a button.
 */
export const SCOUT_EXPORT_COLUMNS: ScoutExportColumn[] = [
  { key: "sno", header: "S.No", width: 6 },
  { key: "handle", header: "Instagram", width: 24 },
  { key: "name", header: "Name", width: 26 },
  { key: "tier", header: "Tier", width: 11 },
  { key: "followers", header: "Followers", width: 12 },
  { key: "follows", header: "Following", width: 11 },
  { key: "posts", header: "Posts", width: 9 },
  { key: "verified", header: "Verified", width: 9 },
  { key: "private", header: "Private", width: 9 },
  { key: "email", header: "Email", width: 28 },
  { key: "website", header: "Website", width: 30 },
  { key: "category", header: "Category", width: 20 },
  { key: "bio", header: "Bio", width: 46 },
  { key: "known", header: "In Our Database", width: 18 },
  { key: "source", header: "Found Via", width: 24 },
  { key: "profileUrl", header: "Profile URL", width: 34 },
  { key: "dmUrl", header: "DM Link", width: 30 },
  { key: "message", header: "Message", width: 60 },
];
