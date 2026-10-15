// Reading the JSON trailer an invitation packs into `notes`.
//
// `influencer_invitations.notes` is prose, then optionally "\n---\n" and a
// JSON object carrying everything that never got a column: city, gender,
// categories, languages, and the enrichment's followers / bio / email /
// verified. See CLAUDE.md, "Description / notes trailer metadata".
//
// SEPARATOR: five characters, "\n---\n". The CAMPAIGN trailer is six,
// "\n\n---\n". Parsing one with the other yields {}, which reads as "no
// metadata" rather than as an error — which is how a gender restriction
// silently became "no restriction" once before.
//
// This is a canonical home for a parser that had been copied into three
// files (enrich-actions, invited-influencer-row, invited-brand-row). Those
// copies still exist and are identical in behaviour; new readers use this
// one so a fourth copy does not appear.

export const INVITATION_NOTES_SEPARATOR = "\n---\n";

/**
 * Tolerates every shape in the wild: null, free text only, bare JSON with no
 * separator, or text + separator + JSON. Never throws — a malformed trailer
 * reads as no metadata, because one bad row must not take down a list.
 */
export function parseInvitationMeta(notes: string | null | undefined): Record<string, unknown> {
  if (!notes) return {};
  const sep = notes.indexOf(INVITATION_NOTES_SEPARATOR);
  const raw =
    sep !== -1
      ? notes.slice(sep + INVITATION_NOTES_SEPARATOR.length)
      : notes.trim().startsWith("{")
        ? notes
        : "";
  if (!raw) return {};
  try {
    return (JSON.parse(raw) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

/** The prose half, with the trailer stripped. */
export function invitationNotesText(notes: string | null | undefined): string {
  if (!notes) return "";
  const sep = notes.indexOf(INVITATION_NOTES_SEPARATOR);
  if (sep !== -1) return notes.slice(0, sep).trim();
  return notes.trim().startsWith("{") ? "" : notes.trim();
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export type InvitationProfileShape = {
  full_name: string | null;
  username: string | null;
  profile_photo_url: string | null;
  followers_count: number | null;
  instagram_handle: string | null;
  categories: string[] | null;
  bio: string | null;
  engagement_rate: number | null;
  email: string | null;
  media_kit_published: boolean;
  location: string | null;
  gender: string | null;
};

/**
 * An invitation dressed as an `influencer_profiles` row.
 *
 * An application can belong to an invitation instead of a profile
 * (rgossips_web migration 088), and for those the PostgREST embed returns
 * nothing. Rather than teach every consumer — the list, the match scorer,
 * the Excel export — that a creator might be shaped two different ways, the
 * page synthesises this once at the fetch and everything downstream carries
 * on unchanged.
 *
 * Fields we genuinely do not hold are null, never zero or "": the match
 * scorer reads null as "unknown" and scores it at half weight, where 0
 * followers would read as a real and very bad answer.
 */
export function invitationAsProfile(inv: {
  full_name?: string | null;
  instagram_username?: string | null;
  profile_photo_url?: string | null;
  notes?: string | null;
}): InvitationProfileShape {
  const meta = parseInvitationMeta(inv.notes);
  const cats = Array.isArray(meta.categories)
    ? (meta.categories as unknown[]).map((c) => String(c)).filter(Boolean)
    : typeof meta.categories === "string" && meta.categories.trim()
      ? String(meta.categories).split(",").map((c) => c.trim()).filter(Boolean)
      : null;
  return {
    full_name: str(inv.full_name),
    username: null,
    profile_photo_url: str(inv.profile_photo_url),
    followers_count: num(meta.followers),
    instagram_handle: str(inv.instagram_username),
    categories: cats && cats.length ? cats : null,
    bio: str(meta.bio),
    // Never collected for an invitation. Null, so the scorer treats it as
    // unknown rather than as a creator with no engagement at all.
    engagement_rate: null,
    email: str(meta.email),
    media_kit_published: false,
    // `city` is the invitation's key; `location` is the profile column.
    location: str(meta.city) ?? str(meta.location),
    gender: str(meta.gender),
  };
}
