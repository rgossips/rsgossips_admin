"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { adminGate } from "@/lib/require-super-admin";

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
  const gate = await adminGate();
  if (gate) return gate;

  const cleanUtr = (utr || "").trim();
  if (!cleanUtr) return { error: "UTR is required." };
  if (cleanUtr.length > 50) return { error: "UTR looks too long (max 50 chars)." };

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
  if (appErr) return { error: "Lookup failed: " + appErr.message };
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
  if (updErr) return { error: "Update failed: " + updErr.message };

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
