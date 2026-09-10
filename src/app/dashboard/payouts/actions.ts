"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { isValidDate, clampLen } from "@/lib/validation";

// Manual payout completion. After replacing RazorpayX with admin-driven
// bank transfers (Option 1), an admin processes payouts via their own
// banking portal, captures the UTR, and pastes it back here so the
// application moves to `completed` and the creator gets notified.

export async function markPayoutPaid(
  applicationId: string,
  utr: string,
  paidAt?: string | null,
  method?: "upi" | "imps" | "neft" | "rtgs" | null,
): Promise<{ ok?: boolean; error?: string }> {
  // Money-moving action — capture the actor for the audit trail.
  let actorId: string;
  try { actorId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const cleanUtr = clampLen(utr, 50);
  if (!cleanUtr) return { error: "UTR is required." };
  // Guard the optional paid-at BEFORE toISOString() — an invalid date
  // string throws RangeError and would crash the action after the gate.
  if (paidAt && !isValidDate(paidAt)) return { error: "Paid-at date is invalid." };

  const admin = createAdminClient();

  // Pull the application first so we can build the notification payload
  // and confirm the payout is in a flippable state.
  const { data: app, error: appErr } = await admin
    .from("campaign_applications")
    .select(
      "id, influencer_id, campaign_id, payout_status, escrow_amount, payout_release_at",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (appErr) { logError("payout.lookup", appErr, { applicationId }); return { error: "Could not load the payout. Please try again." }; }
  if (!app) return { error: "Application not found." };
  if (app.payout_status === "processed" || app.payout_status === "completed") {
    return { error: "This payout is already marked paid." };
  }

  const paidAtIso = paidAt
    ? new Date(paidAt).toISOString()
    : new Date().toISOString();

  // 1. Flip the application row.
  const { error: updErr } = await admin
    .from("campaign_applications")
    .update({
      payout_status: "processed",
      payout_utr: cleanUtr,
      payout_processed_at: paidAtIso,
      payout_method: method || null,
      // Mirror what razorpay-webhook used to do on payout.processed —
      // application status flips to completed so the creator's dashboard
      // shows the campaign as done.
      status: "completed",
    })
    .eq("id", applicationId);
  if (updErr) { logError("payout.update", updErr, { applicationId }); return { error: "Could not update the payout. Please try again." }; }

  // Audit: who marked this payout paid, and for which application.
  await auditLog("payout_marked_paid", actorId, applicationId);

  // 2. Mirror the existing escrow side — once payout is processed, the
  // brand's escrow leg moves from `released_pending` to `released`.
  await admin
    .from("campaign_applications")
    .update({ escrow_status: "released" })
    .eq("id", applicationId)
    .eq("escrow_status", "released_pending");

  // 3. Notify the creator (best-effort, non-blocking on errors).
  try {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("title")
      .eq("campaign_id", app.campaign_id)
      .maybeSingle();
    const amountRupees = app.escrow_amount
      ? Math.round((app.escrow_amount as number) / 100)
      : null;
    const titleText = campaign?.title || "your campaign";
    const body = amountRupees
      ? `₹${amountRupees.toLocaleString("en-IN")} for "${titleText}" has been sent to your account. Reference: ${cleanUtr}`
      : `Your payout for "${titleText}" has been sent. Reference: ${cleanUtr}`;

    await admin.from("notifications").insert({
      user_id: app.influencer_id,
      type: "payout_processed",
      title: "Payout sent ✓",
      body: JSON.stringify({
        text: body,
        link: `/influencer/offers/${app.campaign_id}`,
      }),
      is_read: false,
    });
  } catch (e) {
    console.error("payout notification failed:", e);
  }

  revalidatePath("/dashboard/payouts");
  return { ok: true };
}

// ── Admin-entered payout details ──────────────────────────────────────
//
// Why these exist: a manual payout can bounce because the creator typed
// their UPI or account number wrong. Before this, an admin had no way to
// act on that — nothing in the product could ever set `validation_status`
// to `failed` (the only writer listened for RazorpayX fund-account
// validation events, and RazorpayX was removed), and nothing could enter
// corrected details on a creator's behalf. The payout simply sat in the
// queue while the creator was told their method was "pending review" by a
// review process that did not exist.
//
// Both actions write rows the creator OWNS, so they surface in the
// creator's own Payments screen through the existing own-row RLS read —
// nothing on the client needs to change for them to appear.

// Same NPCI VPA shape register-payout-method enforces. Deliberately
// duplicated rather than loosened: details an admin types are paid out
// exactly like details a creator types, so they clear the same bar.
function isValidUpi(vpa: string): boolean {
  const v = vpa.trim();
  const at = v.indexOf("@");
  if (at < 0 || v.indexOf("@", at + 1) !== -1 || v.length > 50) return false;
  const [user, handle] = v.split("@");
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,49}$/.test(user || "") &&
    /^[a-zA-Z][a-zA-Z0-9.]{1,29}$/.test(handle || "")
  );
}

/**
 * Mark a creator's saved payout details as rejected.
 *
 * `failed` is the one status the creator-facing UI treats as unusable:
 * escrow-release skips such methods, and the Payments screen shows
 * "Details failed" with a prompt to replace them. So this is what turns a
 * bounced transfer into something the creator can see and act on.
 */
export async function markPayoutMethodFailed(
  paymentMethodId: string,
  reason: string,
): Promise<{ ok?: boolean; error?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const cleanReason = clampLen(reason, 200);
  if (!cleanReason) {
    return { error: "A reason is required so the creator knows what to fix." };
  }

  const admin = createAdminClient();

  const { data: method, error: mErr } = await admin
    .from("payment_methods")
    .select("id, user_id, type")
    .eq("id", paymentMethodId)
    .maybeSingle();
  if (mErr) {
    logError("payoutMethod.lookup", mErr, { paymentMethodId });
    return { error: "Could not load that payout method." };
  }
  if (!method) return { error: "Payout method not found." };

  const { error: updErr } = await admin
    .from("payment_methods")
    .update({
      validation_status: "failed",
      validation_failure_reason: cleanReason,
      // A rejected method must not stay primary, or escrow-release would
      // keep preferring it over a working one added afterwards.
      is_primary: false,
    })
    .eq("id", paymentMethodId);
  if (updErr) {
    logError("payoutMethod.fail", updErr, { paymentMethodId });
    return { error: "Could not update that payout method." };
  }

  await auditLog("payout_method_marked_failed", actorId, paymentMethodId);

  // Park any payout queued against it. escrow-release parks on
  // `pending_creator_info`, and register-payout-method resumes from there
  // once usable details arrive — so this returns the row to exactly the
  // state that existing flow already knows how to recover from.
  await admin
    .from("campaign_applications")
    .update({ payout_status: "pending_creator_info" })
    .eq("influencer_id", method.user_id)
    .eq("payout_status", "scheduled");

  try {
    await admin.from("notifications").insert({
      user_id: method.user_id,
      type: "payout_pending_info",
      title: "Your payout details need updating",
      body: JSON.stringify({
        text: `We could not send your payout: ${cleanReason} Please add a working UPI ID or bank account.`,
        link: "/influencer/profile/payments?add=1",
      }),
      is_read: false,
    });
  } catch (e) {
    console.error("payout method failure notification failed:", e);
  }

  revalidatePath("/dashboard/payouts");
  return { ok: true };
}

/**
 * Add corrected payout details on a creator's behalf — for when they have
 * given the right ones over support after a transfer bounced.
 *
 * Mirrors register-payout-method: same validation, same duplicate refusal,
 * same auto-resume of payouts parked on `pending_creator_info`.
 */
export async function addPayoutMethodForCreator(input: {
  userId: string;
  type: "upi" | "bank";
  label?: string | null;
  upiId?: string | null;
  accountHolderName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
}): Promise<{ ok?: boolean; error?: string; resumed?: number }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const { userId, type } = input;
  if (!userId) return { error: "Creator is required." };

  const holder = clampLen(input.accountHolderName || "", 120);
  let row: Record<string, unknown>;

  if (type === "upi") {
    const upi = clampLen(input.upiId || "", 50);
    if (!isValidUpi(upi)) return { error: "That UPI ID does not look valid." };
    row = {
      user_id: userId,
      type: "upi",
      label: clampLen(input.label || "", 60) || "UPI",
      upi_id: upi,
      account_holder_name: holder || null,
    };
  } else if (type === "bank") {
    const acct = clampLen(input.accountNumber || "", 18);
    const ifsc = clampLen(input.ifsc || "", 11).toUpperCase();
    if (!/^[0-9]{9,18}$/.test(acct)) {
      return { error: "Account number must be 9-18 digits." };
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: "IFSC is not valid." };
    if (!holder) return { error: "Account holder name is required." };
    row = {
      user_id: userId,
      type: "bank",
      label: clampLen(input.label || "", 60) || "Bank Account",
      account_holder_name: holder,
      bank_name: clampLen(input.bankName || "", 120) || null,
      account_number: acct,
      ifsc,
    };
  } else {
    return { error: "Unsupported payout method type." };
  }

  const admin = createAdminClient();

  // Confirm the creator exists before writing a row keyed to them — a typo
  // in the id would otherwise create details nobody can ever see or use.
  const { data: profile } = await admin
    .from("influencer_profiles")
    .select("influencer_id")
    .eq("influencer_id", userId)
    .maybeSingle();
  if (!profile) return { error: "No creator profile for that account." };

  // Duplicate refusal, matching register-payout-method: identical details
  // saved twice make "which one gets paid?" ambiguous.
  const { data: existing } = await admin
    .from("payment_methods")
    .select("id, type, upi_id, account_number, ifsc")
    .eq("user_id", userId);

  type ExistingMethod = {
    type: string;
    upi_id: string | null;
    account_number: string | null;
    ifsc: string | null;
  };
  const dupe = (existing || []).find((m: ExistingMethod) => {
    if (m.type !== type) return false;
    if (type === "upi") {
      return (
        String(m.upi_id || "").trim().toLowerCase() ===
        String(row.upi_id).toLowerCase()
      );
    }
    return (
      String(m.account_number || "").trim() === String(row.account_number) &&
      String(m.ifsc || "").trim().toUpperCase() === String(row.ifsc)
    );
  });
  if (dupe) return { error: "Those exact details are already saved on this account." };

  // Admin-entered details become primary: the admin is entering them
  // precisely because whatever was primary did not work.
  await admin.from("payment_methods").update({ is_primary: false }).eq("user_id", userId);

  const { error: insErr } = await admin.from("payment_methods").insert({
    ...row,
    is_primary: true,
    razorpay_fund_account_id: null,
    // Not "success": nothing has verified these either. `manual` is the
    // same status a creator's own entry gets, and escrow-release treats
    // anything that is not `failed` as usable.
    validation_status: "manual",
    validation_failure_reason: null,
    validated_at: null,
  });
  if (insErr) {
    logError("payoutMethod.insert", insErr, { userId });
    return { error: "Could not save those details." };
  }

  await auditLog("payout_method_added_for_creator", actorId, userId);

  // Resume anything parked waiting for details, exactly as
  // register-payout-method does when the creator adds their own.
  const { data: resumed } = await admin
    .from("campaign_applications")
    .update({ payout_status: "scheduled" })
    .eq("influencer_id", userId)
    .eq("payout_status", "pending_creator_info")
    .select("id");

  try {
    await admin.from("notifications").insert({
      user_id: userId,
      type: "payout_method_added",
      title: "New payout details added",
      body: JSON.stringify({
        text: "Our team added payout details to your account. Please check they are correct in Payments.",
        link: "/influencer/profile/payments",
      }),
      is_read: false,
    });
  } catch (e) {
    console.error("payout method added notification failed:", e);
  }

  revalidatePath("/dashboard/payouts");
  return { ok: true, resumed: resumed?.length || 0 };
}
