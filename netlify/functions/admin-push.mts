// Netlify scheduled function: turns outstanding ops work into admin pushes.
//
// It only knocks on /api/admin-push/run — that route owns every rule about
// who gets paged and what counts as new. Scheduled functions run on the
// published production deploy only, never on previews or `next dev`, which
// matters here because a local run would push to real phones.
//
// Every 15 minutes rather than hourly: the things it carries are a brand
// blocked from publishing, a person waiting for a phone call and money owed
// to a creator. An hour is a long time to sit on any of those, and the
// dedupe ledger means a run with nothing new costs one request and sends
// nothing.
//
// Env: NUDGE_SECRET (same value the route checks). URL is set by Netlify.

const adminPush = async () => {
  const base = process.env.URL;
  const secret = process.env.NUDGE_SECRET;
  if (!base || !secret) {
    console.log("[admin-push] URL or NUDGE_SECRET unset — skipping");
    return;
  }
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/admin-push/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  console.log(`[admin-push] ${res.status} ${(await res.text()).slice(0, 300)}`);
};

export default adminPush;
export const config = { schedule: "*/15 * * * *" };
