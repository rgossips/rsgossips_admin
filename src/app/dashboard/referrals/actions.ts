"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { adminGate } from "@/lib/require-super-admin";

// Manual RC adjustment (Phase-0 decision #11). Two modes:
//   grant  → positive delta
//   deduct → negative delta
// Both are ADMIN_ADJUSTMENT ledger rows with the acting admin's id
// stored for audit. Same 90-day expiry + same 50% redemption cap as
// earned RC (decisions #12, #13) — the ledger row uses expires_at =
// now + 90d.

const MAX_ABS_DELTA = 10_000;

export async function adjustRc(
  userId: string,
  deltaRc: number,
  note: string,
): Promise<{ ok?: boolean; error?: string; balanceAfter?: number }> {
  const gate = await adminGate();
  if (gate) return gate;

  const cleanNote = (note || "").trim();
  const cleanDelta = Math.trunc(Number(deltaRc));

  if (!userId) return { error: "userId is required" };
  if (!Number.isFinite(cleanDelta) || cleanDelta === 0) {
    return { error: "Amount must be a non-zero integer" };
  }
  if (Math.abs(cleanDelta) > MAX_ABS_DELTA) {
    return { error: `Amount capped at ±${MAX_ABS_DELTA}` };
  }
  if (!cleanNote) return { error: "A reason note is required for audit" };
  if (cleanNote.length > 500) return { error: "Note is too long (max 500 chars)" };

  const admin = createAdminClient();

  // Resolve the acting admin's id via the session helper. `adminGate`
  // already verified we're admin+ role, so this lookup should always
  // succeed — but fall back to null so the DB doesn't reject.
  let adminId: string | null = null;
  try {
    const { data: { user } } = await admin.auth.getUser();
    adminId = user?.id ?? null;
  } catch { /* leave null */ }

  // Current balance for the snapshot.
  const { data: balRow } = await admin
    .from("v_reward_credits_balance")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  const currentBalance = balRow?.balance || 0;
  const balanceAfter = currentBalance + cleanDelta;

  // Deducts can't drive the wallet negative.
  if (cleanDelta < 0 && balanceAfter < 0) {
    return { error: `User has only ${currentBalance} RC — can't deduct ${Math.abs(cleanDelta)}` };
  }

  // 90-day expiry on positive grants (matches earned RC). Deductions
  // don't need an expiry.
  const expiresAt =
    cleanDelta > 0
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const { error: insErr } = await admin
    .from("reward_credits_ledger")
    .insert({
      user_id: userId,
      delta_rc: cleanDelta,
      reason: "ADMIN_ADJUSTMENT",
      admin_id: adminId,
      note: cleanNote,
      balance_after: balanceAfter,
      expires_at: expiresAt,
    });
  if (insErr) return { error: "Insert failed: " + insErr.message };

  // Best-effort user notification.
  try {
    const label = cleanDelta > 0 ? `You received ${cleanDelta} RC` : `${Math.abs(cleanDelta)} RC was deducted`;
    await admin.from("notifications").insert({
      user_id: userId,
      type: "rc_adjustment",
      title: label,
      body: JSON.stringify({ text: `${label}. Reason: ${cleanNote}`, link: "/influencer/refer" }),
      is_read: false,
    });
  } catch { /* non-fatal */ }

  revalidatePath("/dashboard/referrals");
  return { ok: true, balanceAfter };
}

export async function resolveManualReview(
  referralId: string,
  decision: "approve" | "reject",
): Promise<{ ok?: boolean; error?: string }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  if (decision === "reject") {
    const { error } = await admin
      .from("referrals")
      .update({ status: "REVERSED", reversed_at: new Date().toISOString() })
      .eq("id", referralId)
      .eq("status", "MANUAL_REVIEW");
    if (error) return { error: error.message };
    revalidatePath("/dashboard/referrals");
    return { ok: true };
  }

  // Approve → flip to REWARDED + credit the referrer. Uses the same
  // reward table the webhook uses.
  const REWARD_BY_PLAN: Record<string, number> = { STARTER: 50, PRO: 150, ELITE: 300 };
  const { data: row } = await admin
    .from("referrals")
    .select("id, referrer_id, referee_first_plan, referrer_reward_rc")
    .eq("id", referralId)
    .maybeSingle();
  if (!row) return { error: "Referral not found" };
  const rc = row.referrer_reward_rc || REWARD_BY_PLAN[row.referee_first_plan || ""] || 0;
  if (rc <= 0) return { error: "Cannot determine reward for this plan" };

  const { data: bal } = await admin
    .from("v_reward_credits_balance")
    .select("balance")
    .eq("user_id", row.referrer_id)
    .maybeSingle();
  const balanceAfter = (bal?.balance || 0) + rc;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const { error: refErr } = await admin
    .from("referrals")
    .update({
      status: "REWARDED",
      rewarded_at: new Date().toISOString(),
      referrer_reward_rc: rc,
    })
    .eq("id", referralId)
    .eq("status", "MANUAL_REVIEW");
  if (refErr) return { error: refErr.message };

  await admin.from("reward_credits_ledger").insert({
    user_id: row.referrer_id,
    delta_rc: rc,
    reason: "REFERRAL_EARN",
    ref_referral_id: referralId,
    balance_after: balanceAfter,
    expires_at: expiresAt,
    note: "Manual review approved by admin",
  });

  revalidatePath("/dashboard/referrals");
  return { ok: true };
}
