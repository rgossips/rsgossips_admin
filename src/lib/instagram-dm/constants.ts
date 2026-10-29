// Instagram DM tracking — the vocabulary, in a plain module so the page, the
// client component and the server actions all read one copy.
//
// WHAT IS POSSIBLE HERE, because it is not what people assume. Meta's
// Instagram Messaging API can only SEND inside a 24-hour window that opens
// when the user messages the business first — 7 days with the separately
// approved HUMAN_AGENT tag, which is human-only and may carry no promotional
// content. There is no cold-DM endpoint at any access level. So:
//
//   * reading threads and replies: supported, and that is this feature;
//   * replying to someone who wrote to us: possible, inside the window;
//   * messaging a creator who has never written to us: impossible, and a
//     per-day send cap on it would be a cap on zero.
//
// First contact therefore stays a human pressing send in the Instagram app.
// The `ig.me/m/<handle>` links on the find-creators and scouting pages are
// that path, and they are not a stopgap.

/**
 * Graph API version for the conversations endpoints.
 *
 * Deliberately its own constant and NOT shared with the consumer app's
 * `instagram-connect`, which pins v22.0 for the `/me` profile read it does.
 * These are independent calls against independent field sets, and bumping
 * one should not silently move the other.
 */
export const IG_API_VERSION = "v23.0";

export const IG_GRAPH = `https://graph.instagram.com/${IG_API_VERSION}`;

/**
 * What the admin's authorize URL asks for.
 *
 * `instagram_business_basic` is what identifies the account;
 * `instagram_business_manage_messages` is the one that matters and the one
 * most likely to be missing — it needs to be enabled on the Meta app, and
 * **Advanced Access only if the app serves accounts it does not own**. Our
 * own team's accounts are added in the App Dashboard, so Standard Access
 * covers them and no App Review is needed to start.
 */
export const IG_DM_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"] as const;

/** The scope a connection must hold to read messages at all. */
export const MESSAGING_SCOPE = "instagram_business_manage_messages";

/**
 * How many conversations one sync looks at.
 *
 * A sync costs one request for the thread list, one per thread for its
 * message ids, and one per UNSEEN message for the detail. Threads we have
 * already read are cheap on the second run — the message id is the dedupe
 * key — so the cap is about bounding the FIRST run, not the steady state.
 */
export const SYNC_THREAD_CAP = 60;

/**
 * Message details fetched per thread per run.
 *
 * Meta serves details for only the **20 most recent** messages in a
 * conversation and fails with a "deleted" error on anything older, so 20 is
 * the real ceiling, not a choice. It is also why the local table is
 * append-only: a message not read before it ages out is gone for good.
 */
export const MESSAGES_PER_THREAD = 20;

/** A whole sync is abandoned here so one slow thread cannot hang the action. */
export const SYNC_BUDGET_MS = 20_000;

/** Where Instagram comes back to after the admin authorises. */
export const IG_CALLBACK_PATH = "/dashboard/instagram/callback";

export type ThreadFilter = "all" | "replied" | "awaiting" | "unanswered" | "archived";

export const THREAD_FILTER_LABEL: Record<ThreadFilter, string> = {
  all: "All threads",
  // They wrote back at some point — the question the outreach tracker asks.
  replied: "Replied to us",
  // They spoke last, so the ball is ours.
  awaiting: "Waiting on us",
  // We wrote and they never have. The cohort worth knowing about: it is the
  // measure of whether outreach is landing at all.
  unanswered: "No reply yet",
  archived: "Archived",
};

export const THREAD_FILTER_HINT: Record<ThreadFilter, string> = {
  all: "Every conversation on this connected account, newest first.",
  replied: "Threads where the creator has written to us at least once.",
  awaiting: "The creator sent the last message, so a reply is owed.",
  unanswered: "We have written and heard nothing back.",
  archived: "Threads you have marked as done.",
};
