"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-super-admin";
import { escapeLike } from "@/lib/bulk-invite-utils";
import { friendlyDbError } from "@/lib/log";

// Manual RC adjustment (Phase-0 decision #11). Two modes:
//   grant  → positive delta
//   deduct → negative delta
// Both are ADMIN_ADJUSTMENT ledger rows with the acting admin's id
// stored for audit. Same 90-day expiry + same 50% redemption cap as
// earned RC (decisions #12, #13) — the ledger row uses expires_at =
// now + 90d.

const MAX_ABS_DELTA = 10_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The admin types an Instagram username; the ledger keys on the profile
// UUID. Resolve here (server-side, after the gate) rather than in the form
// — a client-side lookup would need an ungated read of influencer PII.
//
// Instagram handles have no unique constraint, so a multi-hit is possible;
// we refuse rather than guess, because picking the wrong row silently moves
// money to the wrong creator. A raw UUID is still accepted so an admin
// holding an id (or an ambiguous handle) always has a way through.
async function resolveInfluencer(
  admin: ReturnType<typeof createAdminClient>,
  input: string,
): Promise<{ userId?: string; label?: string; error?: string }> {
  const raw = (input || "").trim().replace(/^@+/, "");
  if (!raw) return { error: "Instagram username is required" };

  const describe = (p: any, fallback: string) =>
    p?.instagram_handle
      ? `${p.full_name || p.username || "Creator"} (@${p.instagram_handle})`
      : p?.full_name || p?.username || fallback;

  if (UUID_RE.test(raw)) {
    const { data } = await admin
      .from("influencer_profiles")
      .select("influencer_id, full_name, username, instagram_handle")
      .eq("influencer_id", raw)
      .maybeSingle();
    // Not finding a profile isn't fatal — the wallet is keyed on user id
    // and a non-influencer user can still hold RC.
    return { userId: raw, label: describe(data, raw) };
  }

  const { data, error } = await admin
    .from("influencer_profiles")
    .select("influencer_id, full_name, username, instagram_handle")
    // escapeLike so a handle's `_` isn't treated as a LIKE wildcard
    // (priya_sharma would otherwise match priyaXsharma).
    .ilike("instagram_handle", escapeLike(raw))
    .limit(5);

  if (error) return { error: friendlyDbError("referrals.resolveInfluencer", error, "Lookup failed") };
  if (!data || data.length === 0) return { error: `No influencer found with Instagram username @${raw}` };
  if (data.length > 1) {
    return {
      error: `@${raw} matches ${data.length} profiles — use the influencer's user id instead`,
    };
  }
  return { userId: data[0].influencer_id, label: describe(data[0], raw) };
}

export async function adjustRc(
  usernameOrId: string,
  deltaRc: number,
  note: string,
): Promise<{ ok?: boolean; error?: string; balanceAfter?: number; label?: string }> {
  // requireAdmin returns the acting admin's id — needed for the audit
  // trail below. (The old admin.auth.getUser() on the service-role client
  // has no session and always returned null, so admin_id was never
  // recorded on these financial ledger rows.)
  let adminId: string;
  try { adminId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const cleanNote = (note || "").trim();
  const cleanDelta = Math.trunc(Number(deltaRc));

  if (!Number.isFinite(cleanDelta) || cleanDelta === 0) {
    return { error: "Amount must be a non-zero integer" };
  }
  if (Math.abs(cleanDelta) > MAX_ABS_DELTA) {
    return { error: `Amount capped at ±${MAX_ABS_DELTA}` };
  }
  if (!cleanNote) return { error: "A reason note is required for audit" };
  if (cleanNote.length > 500) return { error: "Note is too long (max 500 chars)" };

  const admin = createAdminClient();

  // Validate the amount/note first so a typo'd username doesn't cost a
  // lookup, then resolve the handle → the UUID the ledger keys on.
  const resolved = await resolveInfluencer(admin, usernameOrId);
  if (resolved.error) return { error: resolved.error };
  const userId = resolved.userId!;

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
  // label echoes back who actually got credited — this is a money action
  // and the admin typed a handle, so confirming the resolved identity is
  // the only way they can catch a wrong-creator hit.
  return { ok: true, balanceAfter, label: resolved.label };
}

export async function resolveManualReview(
  referralId: string,
  decision: "approve" | "reject",
): Promise<{ ok?: boolean; error?: string }> {
  // requireAdmin returns the reviewer's id for the audit trail (the old
  // service-role admin.auth.getUser() always returned null).
  let reviewerId: string;
  try { reviewerId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const admin = createAdminClient();

  if (decision === "reject") {
    const { error } = await admin
      .from("referrals")
      .update({
        status: "REVERSED",
        reversed_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
      })
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
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
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

  // Fire the "you earned RC" notification the webhook would have sent
  // if this had qualified naturally. Best-effort — never block approval.
  try {
    await admin.from("notifications").insert({
      user_id: row.referrer_id,
      type: "referral_earned",
      title: `You earned ${rc} RC!`,
      body: JSON.stringify({
        text: `Your referral just cleared review. ${rc} RC has landed in your wallet.`,
        link: "/influencer/refer",
      }),
      is_read: false,
    });
  } catch { /* non-fatal */ }

  // Same event → also fire the branded email so the referrer hears the
  // approval outcome on both channels. Silent if they have no email on
  // file or if the send-email invoke errors.
  try {
    const { data: prof } = await admin
      .from("influencer_profiles")
      .select("email")
      .eq("influencer_id", row.referrer_id)
      .maybeSingle();
    const to = prof?.email;
    if (to) {
      await admin.functions.invoke("send-email", {
        body: {
          to,
          subject: `You earned ${rc} RC on RGossips`,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:24px">
            <h2 style="margin:0 0 10px">+${rc} RC just landed in your wallet</h2>
            <p style="color:#475569;line-height:1.6">Your referral has cleared review and <strong>${rc} RC</strong> has been credited. Spend up to 50% of any plan price at your next renewal.</p>
            <p style="margin-top:20px"><a href="https://rgossips.com/influencer/refer" style="background:linear-gradient(135deg,#9810FA,#E60076);color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">Open your wallet</a></p>
          </div>`,
        },
      });
    }
  } catch { /* non-fatal */ }

  revalidatePath("/dashboard/referrals");
  return { ok: true };
}
