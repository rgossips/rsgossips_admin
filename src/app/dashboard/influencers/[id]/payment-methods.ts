// Plain module (NOT "use server"): the row type and the masking rules are
// shared by the server action, the page and the client card, and a
// "use server" file may only export async functions.

export type PaymentMethodRow = {
  id: string;
  user_id: string;
  /** "upi" | "bank" — 8 upi and 3 bank across the 11 live rows. */
  type: string | null;
  label: string | null;
  upi_id: string | null;
  account_holder_name: string | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  is_primary: boolean | null;
  /** pending | manual | verified | failed — written by the payout flow. */
  validation_status: string | null;
  validation_failure_reason: string | null;
  validated_at: string | null;
  razorpay_fund_account_id: string | null;
  created_at: string | null;
};

const KEEP = 4;

/**
 * Last four digits, the convention every bank statement already uses.
 *
 * Enough for an admin to confirm they are looking at the right account
 * against a payout they just made, and useless to anyone who should not
 * have it.
 */
export function maskAccountNumber(v: string | null | undefined): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  if (s.length <= KEEP) return "•".repeat(s.length);
  return "•".repeat(Math.min(s.length - KEEP, 8)) + s.slice(-KEEP);
}

/**
 * A UPI ID is `handle@provider`, and the provider is not a secret — it is
 * which bank they use, and it helps an admin tell two saved IDs apart. The
 * handle half is the part that identifies the account, so that is what is
 * covered. A malformed value with no "@" is masked whole rather than
 * assumed safe.
 */
export function maskUpiId(v: string | null | undefined): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const at = s.lastIndexOf("@");
  if (at <= 0) return "•".repeat(Math.min(s.length, 10));
  const user = s.slice(0, at);
  const domain = s.slice(at);
  const shown = user.length <= 2 ? "" : user.slice(-2);
  return "•".repeat(Math.min(Math.max(user.length - shown.length, 1), 8)) + shown + domain;
}

/**
 * Strip every secret before the row crosses to the browser.
 *
 * The masking happens HERE, on the server, rather than in the card's CSS
 * or by hiding a rendered value — a value that reaches the client is
 * readable in the RSC payload whether or not it is painted. Only the
 * reveal action, which is gated and audited, ever sends the real thing.
 */
export function maskPaymentMethod(m: PaymentMethodRow): PaymentMethodRow {
  return {
    ...m,
    upi_id: maskUpiId(m.upi_id),
    account_number: maskAccountNumber(m.account_number),
    // IFSC is a public branch code, printed on every cheque. Left intact:
    // an admin confirming a destination bank should not need the reveal.
    ifsc: m.ifsc,
  };
}
