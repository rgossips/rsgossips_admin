import { createAdminClient } from "@/utils/supabase/admin";
import { logError } from "@/lib/log";

// DB-backed rolling-window rate limiter for the admin portal's sensitive
// actions (email sends, invites, bulk imports, status toggles). Backed by
// public.admin_activity_log (migration 040), which also serves as an audit
// trail. There's no Redis in this deploy, so the shared Postgres is the
// coordination point across serverless invocations.
//
// Fails OPEN on limiter infrastructure errors: a broken limiter must never
// block legitimate admin work — the per-action role gate is the real
// security boundary, this is abuse/DoS defense-in-depth. Every failure is
// logged so an outage is visible.

export interface RateLimitOptions {
  action: string;        // e.g. "send_invite_email", "bulk_invite"
  actorId: string;       // the acting admin's user id (from requireAdmin())
  limit: number;         // max allowed within the window
  windowSec: number;     // rolling window length in seconds
  target?: string;       // optional subject (recipient, influencer id, …)
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

// Records an audit row and enforces the limit. Returns { allowed:false }
// when the actor has already performed `action` `limit` times in the last
// `windowSec` seconds.
export async function enforceRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const { action, actorId, limit, windowSec, target } = opts;
  if (!actorId) return { allowed: true }; // no actor → can't key; let gate handle authz
  const admin = createAdminClient();
  const since = new Date(Date.now() - windowSec * 1000).toISOString();

  try {
    const { count, error } = await admin
      .from("admin_activity_log")
      .select("id", { count: "exact", head: true })
      .eq("action", action)
      .eq("actor_id", actorId)
      .gte("created_at", since);
    if (error) throw error;

    if ((count ?? 0) >= limit) {
      return { allowed: false, retryAfterSec: windowSec };
    }

    // Record the action (rate-limit counter + audit trail). Best-effort.
    const { error: insErr } = await admin
      .from("admin_activity_log")
      .insert({ action, actor_id: actorId, target: target ?? null });
    if (insErr) logError("rate-limit.insert", insErr, { action, actorId });

    return { allowed: true };
  } catch (e) {
    logError("rate-limit", e, { action, actorId });
    return { allowed: true }; // fail open
  }
}

// Audit-only record (no limit check) for money-moving / privileged actions
// so there's a who-did-what trail even when there's no rate to enforce.
export async function auditLog(action: string, actorId: string | null, target?: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("admin_activity_log").insert({ action, actor_id: actorId, target: target ?? null });
  } catch (e) {
    logError("audit-log", e, { action, actorId });
  }
}
