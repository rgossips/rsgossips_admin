"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin } from "@/lib/require-super-admin";
import { auditLog, enforceRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { isNudgeKey, NUDGE_CHUNK_SIZE, type NudgeKey } from "@/lib/nudges/constants";
import { directRecipient, loadNudgeContext, searchCreators, segment, type CreatorMatch, type NudgeVars } from "@/lib/nudges/segments";
import { renderNudge } from "@/lib/nudges/templates";
import { deliverNudge, nudgeSecret, type NudgeSendResult } from "@/lib/nudges/send";

// Stand-in values for previewing a nudge nobody is eligible for yet.
const SAMPLE_VARS: NudgeVars = {
  firstName: "Priya",
  activeCampaigns: 75,
  newCampaigns7d: 4,
  appsUsed: 1,
  freeLeft: 2,
  followers: 24_500,
  igStatus: "authorized",
  subscribed: false,
};

export async function previewNudge(
  key: string,
): Promise<{ error?: string; subject?: string; preview?: string; html?: string; push?: { title: string; text: string; link: string }; sampleOf?: string }> {
  const denied = await adminGate();
  if (denied) return denied;
  if (!isNudgeKey(key)) return { error: "Unknown nudge." };
  try {
    const ctx = await loadNudgeContext();
    const first = segment(key, ctx)[0];
    const msg = renderNudge(key, first?.vars ?? SAMPLE_VARS, "#unsubscribe-preview");
    return { subject: msg.subject, preview: msg.preview, html: msg.html, push: msg.push, sampleOf: first ? first.name : undefined };
  } catch (e) {
    logError("nudges.preview", e, { key });
    return { error: "Couldn't build the preview." };
  }
}

export async function sendNudgeChunk(
  key: string,
  userIds: string[],
): Promise<{ error?: string; results?: NudgeSendResult[]; skipped?: number }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch {
    return { error: "Only admins can send nudges." };
  }
  if (!isNudgeKey(key)) return { error: "Unknown nudge." };
  if (!Array.isArray(userIds) || userIds.length === 0) return { results: [] };
  if (userIds.length > NUDGE_CHUNK_SIZE) return { error: `At most ${NUDGE_CHUNK_SIZE} creators per request.` };
  if (!nudgeSecret()) return { error: "NUDGE_SECRET isn't set on the server (min 24 characters). Add it and redeploy." };

  const limit = await enforceRateLimit({ action: "send_nudges", actorId, limit: 120, windowSec: 3600, target: key });
  if (!limit.allowed) return { error: "Too many nudge sends in the last hour. Try again later." };

  try {
    const ctx = await loadNudgeContext();
    if (!ctx.live) return { error: "Apply RS_Gossips migration 074 first." };
    // Never trust the client's list: re-check each id against the rules now.
    const wanted = new Set(userIds);
    const recipients = segment(key as NudgeKey, ctx).filter((r) => wanted.has(r.userId));
    const results = await deliverNudge(key as NudgeKey, recipients, { actorId, mode: "manual" });
    await auditLog("creator_nudge", actorId, `${key}: ${results.length} sent`);
    return { results, skipped: userIds.length - recipients.length };
  } catch (e) {
    logError("nudges.send", e, { key, count: userIds.length });
    return { error: e instanceof Error ? e.message : "Sending failed." };
  }
}

// ── Direct send: search a creator, pick any template ─────────────────────

export async function searchCreatorsForNudge(query: string): Promise<{ error?: string; matches?: CreatorMatch[] }> {
  const denied = await adminGate();
  if (denied) return denied;
  try {
    const ctx = await loadNudgeContext();
    return { matches: searchCreators(ctx, String(query || "").slice(0, 100)) };
  } catch (e) {
    logError("nudges.search", e);
    return { error: "Search failed." };
  }
}

export async function previewNudgeFor(
  key: string,
  userId: string,
): Promise<{ error?: string; subject?: string; preview?: string; html?: string; push?: { title: string; text: string; link: string }; sampleOf?: string }> {
  const denied = await adminGate();
  if (denied) return denied;
  if (!isNudgeKey(key)) return { error: "Unknown template." };
  try {
    const ctx = await loadNudgeContext();
    const found = directRecipient(ctx, userId);
    if (!found) return { error: "Creator not found." };
    // A blocked creator can still be previewed — the send is what's refused.
    const msg = renderNudge(key, found.recipient.vars, "#unsubscribe-preview");
    return { subject: msg.subject, preview: msg.preview, html: msg.html, push: msg.push, sampleOf: found.match.name };
  } catch (e) {
    logError("nudges.previewFor", e, { key });
    return { error: "Couldn't build the preview." };
  }
}

export async function sendNudgeTo(
  key: string,
  userId: string,
): Promise<{ error?: string; result?: NudgeSendResult }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch {
    return { error: "Only admins can send nudges." };
  }
  if (!isNudgeKey(key)) return { error: "Unknown template." };
  if (!nudgeSecret()) return { error: "NUDGE_SECRET isn't set on the server (min 24 characters). Add it and redeploy." };

  const limit = await enforceRateLimit({ action: "send_nudge_direct", actorId, limit: 60, windowSec: 3600, target: userId });
  if (!limit.allowed) return { error: "Too many direct sends in the last hour. Try again later." };

  try {
    const ctx = await loadNudgeContext();
    if (!ctx.live) return { error: "Apply RS_Gossips migration 074 first." };
    const found = directRecipient(ctx, userId);
    if (!found) return { error: "Creator not found." };
    if (found.blockedReason) return { error: found.blockedReason };
    const [result] = await deliverNudge(key, [found.recipient], { actorId, mode: "manual" });
    await auditLog("creator_nudge_direct", actorId, `${key} → ${userId}`);
    revalidatePath("/dashboard/nudges");
    return { result };
  } catch (e) {
    logError("nudges.sendTo", e, { key, userId });
    return { error: e instanceof Error ? e.message : "Sending failed." };
  }
}

export async function setAutoNudges(enabled: boolean): Promise<{ error?: string; success?: boolean }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch {
    return { error: "Only admins can change this." };
  }
  const { error } = await createAdminClient()
    .from("creator_nudge_settings")
    .upsert({ id: true, auto_enabled: !!enabled, updated_by: actorId, updated_at: new Date().toISOString() });
  if (error) {
    logError("nudges.setAuto", error, { enabled });
    return { error: "Couldn't save. Is migration 074 applied?" };
  }
  await auditLog("creator_nudge_auto", actorId, enabled ? "on" : "off");
  revalidatePath("/dashboard/nudges");
  return { success: true };
}
