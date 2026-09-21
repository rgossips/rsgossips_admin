import { type NextRequest } from "next/server";
import { logError } from "@/lib/log";
import { auditLog } from "@/lib/rate-limit";
import { AUTO_HOURS_IST, AUTO_PRIORITY, AUTO_RUN_LIMIT, AUTO_RUN_TIME_BUDGET_MS, type NudgeKey } from "@/lib/nudges/constants";
import { loadNudgeContext, segment, type NudgeRecipient } from "@/lib/nudges/segments";
import { authorizedCron, deliverNudge, readAutoEnabled } from "@/lib/nudges/send";

// Automatic creator nudges. Called hourly by the Netlify scheduled function
// netlify/functions/nudges-auto.mts with `Authorization: Bearer $NUDGE_SECRET`.
// Excluded from the session redirect in utils/supabase/middleware.ts.
//
// Does nothing unless the "Automatic" switch on /dashboard/nudges is on. When
// it is: only inside AUTO_HOURS_IST, at most AUTO_RUN_LIMIT creators per run,
// one nudge per creator (highest-intent first, AUTO_PRIORITY). The same
// eligibility rules as a manual send apply, including the 48-hour cap.

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function istHour(): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
}

export async function POST(request: NextRequest) {
  if (!authorizedCron(request.headers.get("authorization"))) return json({ error: "Unauthorized" }, 401);

  const enabled = await readAutoEnabled();
  if (enabled === null) return json({ skipped: "migration 074 not applied" });
  if (!enabled) return json({ skipped: "automatic nudges are off" });

  const hour = istHour();
  if (hour < AUTO_HOURS_IST.from || hour >= AUTO_HOURS_IST.to) return json({ skipped: `outside sending hours (${hour}:00 IST)` });

  try {
    const ctx = await loadNudgeContext();
    const picked = new Set<string>();
    const plan: [NudgeKey, NudgeRecipient[]][] = [];
    let budget = AUTO_RUN_LIMIT;
    for (const key of AUTO_PRIORITY) {
      if (budget <= 0) break;
      const batch = segment(key, ctx).filter((r) => !picked.has(r.userId)).slice(0, budget);
      for (const r of batch) picked.add(r.userId);
      budget -= batch.length;
      if (batch.length) plan.push([key, batch]);
    }

    // Stop starting new nudges once the time budget is spent — whoever is
    // left simply qualifies again next hour (nothing was recorded for them).
    const started = Date.now();
    const summary: Record<string, number> = {};
    for (const [key, batch] of plan) {
      if (Date.now() - started > AUTO_RUN_TIME_BUDGET_MS) break;
      const results = await deliverNudge(key, batch, { actorId: null, mode: "auto" });
      summary[key] = results.length;
    }
    if (plan.length) await auditLog("creator_nudge_auto_run", null, JSON.stringify(summary));
    return json({ sent: summary });
  } catch (e) {
    logError("nudges.auto", e);
    return json({ error: "run failed" }, 500);
  }
}
