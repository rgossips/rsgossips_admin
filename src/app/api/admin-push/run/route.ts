import { type NextRequest } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { produceAdminPush } from "@/lib/admin-push";
import { logError } from "@/lib/log";

// Turns the ops feed into one push per admin per new item.
//
// Called by netlify/functions/admin-push.mts with
// `Authorization: Bearer $NUDGE_SECRET` — the same shared cron secret the
// nudges job uses, because it guards the same class of thing (a scheduled
// endpoint that can send to real people) and a second secret is a second
// thing to rotate and forget. Like /api/nudges/*, this path is excluded
// from the session redirect in utils/supabase/middleware.ts.
//
// Safe to call twice: admin_push_log's unique index means the second call
// finds nothing new and sends nothing.

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function authorized(header: string | null): boolean {
  const secret = process.env.NUDGE_SECRET;
  // No secret configured means no authorisation is possible — refuse rather
  // than run unauthenticated, which is how a public endpoint that pushes to
  // every admin would happen.
  if (!secret || secret.length < 24) return false;
  return header === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const result = await produceAdminPush(createAdminClient());
    return json(result, result.error ? 500 : 200);
  } catch (e) {
    logError("admin-push.run", e, {});
    return json({ error: "Run failed" }, 500);
  }
}
