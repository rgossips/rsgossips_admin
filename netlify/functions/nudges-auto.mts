// Netlify scheduled function: hourly trigger for automatic creator nudges.
//
// It only knocks on /api/nudges/auto — that route decides whether anything
// goes out (the "Automatic" switch on /dashboard/nudges, sending hours, caps).
// With the switch off, every run is a no-op. Scheduled functions run on the
// published production deploy only, never on previews or `next dev`.
//
// Env: NUDGE_SECRET (same value the route checks). URL is set by Netlify.

const nudgesAuto = async () => {
  const base = process.env.URL;
  const secret = process.env.NUDGE_SECRET;
  if (!base || !secret) {
    console.log("[nudges-auto] URL or NUDGE_SECRET unset — skipping");
    return;
  }
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/nudges/auto`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  console.log(`[nudges-auto] ${res.status} ${(await res.text()).slice(0, 300)}`);
};

export default nudgesAuto;
export const config = { schedule: "@hourly" };
