import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-plans";
import { getRazorpayCollected } from "@/lib/razorpay-collected";

// Read-only stats feed for the Windows desktop widget (widget/ in this repo).
//
// Why a token and not the admin session: the widget is a PowerShell script
// with no browser login. Why not hand it the Supabase keys: a service-role key
// in a desktop config file is full database access. This route runs with the
// service role server-side and returns ONLY aggregate counts and totals — no
// names, phones or ids — so the token's blast radius is "someone sees today's
// numbers". It is excluded from the session redirect in utils/supabase/middleware.ts.
//
// Env: WIDGET_API_TOKEN (≥ 24 chars). Unset → the endpoint is disabled (503).

const MIN_TOKEN_LEN = 24;

function authorized(request: NextRequest): boolean | "disabled" {
  const expected = process.env.WIDGET_API_TOKEN || "";
  if (expected.length < MIN_TOKEN_LEN) return "disabled";
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// India calendar day — admins and the widget read the clock in IST.
function todayStartIst(): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:30`);
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  const auth = authorized(request);
  if (auth === "disabled") return json({ status: "error", error: "Widget API is not enabled (WIDGET_API_TOKEN unset)." }, 503);
  if (!auth) return json({ status: "error", error: "Unauthorized" }, 401);

  const start = todayStartIst();
  const startIso = start.toISOString();
  const admin = createAdminClient();
  const head = { count: "exact" as const, head: true };
  const paidTiers = SUBSCRIPTION_TIERS.map((t) => t.key);

  const [subsTotal, subsToday, infTotal, infToday, brandTotal, brandToday, collected] = await Promise.all([
    admin.from("influencer_profiles").select("influencer_id", head).in("subscription_plan", paidTiers),
    // RS_Gossips migration 067. A head count on a missing table returns
    // { error: null, count: null } — null means "not live", never 0.
    admin.from("subscription_events").select("id", head).eq("is_new_purchase", true).gte("occurred_at", startIso),
    admin.from("influencer_profiles").select("influencer_id", head),
    admin.from("influencer_profiles").select("influencer_id", head).gte("created_at", startIso),
    admin.from("brand_profiles").select("brand_id", head),
    admin.from("brand_profiles").select("brand_id", head).gte("created_at", startIso),
    getRazorpayCollected(Math.floor(start.getTime() / 1000)),
  ]);

  const dbFailed = [subsTotal, infTotal, infToday, brandTotal, brandToday].find((r) => r.error);
  if (dbFailed?.error) {
    console.error("[widget.stats]", JSON.stringify({ message: dbFailed.error.message, code: dbFailed.error.code }));
    return json({ status: "error", error: "Database unavailable" }, 502);
  }

  const n = (v: number | null) => v ?? 0;
  return json({
    status: "success",
    generatedAt: new Date().toISOString(),
    todayStart: startIso,
    subscriptions: {
      today: subsToday.error || subsToday.count === null ? null : subsToday.count,
      total: n(subsTotal.count),
    },
    signups: {
      today: n(infToday.count) + n(brandToday.count),
      total: n(infTotal.count) + n(brandTotal.count),
      influencersToday: n(infToday.count),
      brandsToday: n(brandToday.count),
      influencersTotal: n(infTotal.count),
      brandsTotal: n(brandTotal.count),
    },
    collected: collected.ok
      ? {
          source: "razorpay",
          currency: "INR",
          today: collected.todayPaise / 100,
          total: collected.totalPaise / 100,
          paymentsToday: collected.todayCount,
          totalIsPartial: collected.totalIsPartial,
        }
      : { source: "razorpay", currency: "INR", today: null, total: null, error: collected.reason, message: collected.message },
  });
}
