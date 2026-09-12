import { createAdminClient } from "@/utils/supabase/admin";
import { logError } from "@/lib/log";

// Single owner of the `notifications` insert shape for the admin portal.
//
// The consumer app (rgossips_web) is the reader, and both its notification
// UIs — `src/app/influencer/notifications/page.js` and
// `src/app/brands/notifications/page.js` — do `JSON.parse(notif.body)` and
// pull `text` + `link` out of it. A plain-string body still renders (their
// parseBody falls back to the raw string) but loses the tap-through, so the
// JSON envelope is mandatory here, not stylistic.
//
// An unrecognised `type` degrades gracefully over there: the icon/background
// maps fall back to a generic bell. So a new type is safe to ship from this
// side alone — it just looks nicer once the consumer repo adds it to ICON_MAP.
//
// IMPORTANT: every insert fires `notifications_push_after_insert`
// (rgossips_web migration 056), which fans the row out to web push + FCM for
// each of the user's registered devices. A notification here is a real push
// on someone's phone — so notify on decisions the user is waiting for, not on
// every internal state change.
//
// Best-effort by contract: these are called AFTER the state change they
// describe has already committed, so a notification failure must never turn a
// successful action into an error. Failures are logged and swallowed.

export type NotifyBody = { text: string; link: string } & Record<string, unknown>;

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: NotifyBody;
}

function toRow(n: NotifyInput) {
  return {
    user_id: n.userId,
    type: n.type,
    title: n.title,
    body: JSON.stringify(n.body),
    is_read: false,
  };
}

/** Fire one notification. Returns false if it didn't land (already logged). */
export async function notifyUser(n: NotifyInput, scope = "notify"): Promise<boolean> {
  if (!n.userId) return false;
  try {
    const { error } = await createAdminClient().from("notifications").insert(toRow(n));
    if (error) {
      logError(`${scope}.insert`, error, { userId: n.userId, type: n.type });
      return false;
    }
    return true;
  } catch (e) {
    logError(`${scope}.threw`, e, { userId: n.userId, type: n.type });
    return false;
  }
}

/** Fire several at once. Same best-effort contract. */
export async function notifyUsers(list: NotifyInput[], scope = "notify"): Promise<boolean> {
  const rows = list.filter((n) => n.userId).map(toRow);
  if (rows.length === 0) return false;
  try {
    const { error } = await createAdminClient().from("notifications").insert(rows);
    if (error) {
      logError(`${scope}.insertMany`, error, { count: rows.length });
      return false;
    }
    return true;
  } catch (e) {
    logError(`${scope}.threwMany`, e, { count: rows.length });
    return false;
  }
}
