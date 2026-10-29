// The outreach note an admin pastes into an Instagram DM, and the rules for
// filling a creator's name into it.
//
// ONE owner, because two surfaces write this message now — Instagram
// scouting (creators we do not have) and campaign matching (creators we do)
// — and the greeting rules below are not obvious enough to re-derive. A
// second copy is how one of them starts greeting aggregator accounts by
// their first word again.
//
// Tokens are written the way an admin would type them rather than as
// {{mustache}}: these boxes are meant to be edited by whoever is doing the
// outreach, not maintained like code.

export const MESSAGE_TOKEN = "<Creator Name>";
export const FIRST_NAME_TOKEN = "<First Name>";
export const HANDLE_TOKEN = "<handle>";
/** Only ever filled on a campaign surface; elsewhere there is no campaign. */
export const CAMPAIGN_TOKEN = "<Campaign>";

export const DEFAULT_OUTREACH_MESSAGE = `Hi ${MESSAGE_TOKEN}!

We have a collaboration opportunity for you related to your niche.

Kindly let us know if you are interested!`;

/**
 * A display name fit to greet someone by.
 *
 * Instagram display names are decorated: emoji, flags, pipes, "| Fashion
 * blogger", stylised unicode. Strip that, then fall back to the handle when
 * nothing legible survives — "Hi riyagadhavi09!" beats "Hi !".
 */
export function displayName(fullName: string | null | undefined, username: string): string {
  const raw = (fullName || "").trim();
  if (!raw) return username;
  const cleaned = raw
    // Everything after a separator is a job title, not a name.
    .split(/[|•·(–—]/)[0]
    // Emoji, flags and variation selectors.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // Must contain a real letter — Latin or Devanagari covers what we see.
  return /[A-Za-zऀ-ॿ]/.test(cleaned) ? cleaned : username;
}

/**
 * The first word of that, for a warmer greeting.
 *
 * NOT the default, and the measurement is why: searching "fashion blogger
 * india" returns mostly AGGREGATOR accounts — "Indian Fashion Bloggers",
 * "Fashion Bloggers India" — and a first-word greeting turns those into
 * "Hi Indian!" and "Hi Fashion!". Across 22 real results only a handful
 * were people. So <Creator Name> uses the whole cleaned name, which is
 * never embarrassing, and <First Name> is offered for when you can see the
 * row is a person.
 */
export function firstName(fullName: string | null | undefined, username: string): string {
  const full = displayName(fullName, username);
  if (full === username) return username;
  const first = full.split(/\s+/)[0] || "";
  return /[A-Za-zऀ-ॿ]/.test(first) ? first : full;
}

/**
 * Fill the tokens. Split/join rather than a regex replace, so a name
 * containing `$&` or a backslash cannot rewrite the message around it.
 */
export function fillTemplate(
  template: string,
  subject: { fullName?: string | null; username: string; campaign?: string | null },
): string {
  const { fullName = null, username, campaign } = subject;
  return template
    .split(MESSAGE_TOKEN)
    .join(displayName(fullName, username))
    .split(FIRST_NAME_TOKEN)
    .join(firstName(fullName, username))
    .split(HANDLE_TOKEN)
    .join(`@${username}`)
    .split(CAMPAIGN_TOKEN)
    .join(campaign || "");
}
