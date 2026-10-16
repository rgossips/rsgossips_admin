"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError } from "@/lib/log";
import type { PaymentMethodRow } from "./payment-methods";

/**
 * The creator's payout details, unmasked.
 *
 * Payouts have been manual since RazorpayX was removed, so an admin paying
 * somebody genuinely needs the full account number — masking it forever
 * would just mean reading it out of the database by hand instead. What it
 * must NOT be is ambient: a bank account should not be on screen for
 * everyone who happens to open a creator's page.
 *
 * Hence the split. The page renders the methods masked, with no secret in
 * the payload at all, and this action returns the real values on an
 * explicit press. Gated at `requireAdmin` rather than `viewerGate` — a
 * read-only account has no reason to see a bank account — and audit-logged
 * every time, because "who looked at this creator's bank details" is a
 * question somebody eventually asks. The applicant export is audited for
 * carrying an email and a phone number; this is a tier above that.
 */
export async function revealPaymentMethods(
  influencerId: string,
): Promise<{ error?: string; methods?: PaymentMethodRow[] }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!influencerId) return { error: "Missing creator" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_methods")
    .select("*")
    .eq("user_id", influencerId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) return { error: friendlyDbError("payment-methods.reveal", error, "Could not read the payout details") };

  // Logged BEFORE returning, so a reveal is on the record even if the
  // response never reaches the browser.
  await auditLog("payment_methods_view", actorId, influencerId);

  return { methods: (data || []) as PaymentMethodRow[] };
}
