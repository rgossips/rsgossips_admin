// Where a barter application is in getting the product to the creator.
//
// Derived from the row on every read — never stored, never scheduled. The
// "they haven't told us it arrived" reminder is the same derivation, so it
// costs nothing and can never be stale: no cron, no background job, and the
// creator app can compute the identical answer on open.
//
// The campaign says HOW in its description trailer (`shipping_required`):
//   "no"     — nothing physical changes hands
//   "yes"    — we ship it, so we need the creator's address
//   "pickup" — the creator collects, so the BRAND supplies the address and
//              the creator supplies nothing
//
// Columns live on campaign_applications (rgossips_web migration 076).

export type ShippingMode = "no" | "yes" | "pickup";

export type FulfilmentStage =
  | "not_applicable" // nothing ships
  | "awaiting_address" // we ship, but don't know where yet
  | "ready_to_ship" // address in hand, nothing dispatched
  | "shipped" // tracking recorded
  | "received" // creator confirmed it arrived
  | "not_received"; // creator said it did NOT arrive — needs a human

// The subset of an application this module needs. Deliberately structural so
// both a server component's row and the client's props satisfy it.
export type FulfilmentRow = {
  status: string | null;
  shipping_address: string | null;
  shipping_address_requested_at: string | null;
  shipping_tracking_url: string | null;
  shipping_expected_at: string | null;
  product_received: boolean | null;
  product_received_at: string | null;
};

// Default window when the campaign doesn't say. Five days is the courier
// reality for most of India, and it only decides when a nudge appears.
export const DEFAULT_SHIPPING_DAYS = 5;

export function normalizeShippingMode(value: unknown): ShippingMode {
  return value === "yes" || value === "pickup" ? value : "no";
}

// An application can be dispatched from approval onwards, not only once it is
// complete. For most barter deals the creator physically needs the product in
// order to make the content, so gating tracking behind `completed` would mean
// nothing could ever ship on time.
const DISPATCHABLE = new Set(["approved", "submitted", "revision_needed", "accepted", "live_submitted", "payment", "completed"]);

export function fulfilmentState(
  row: FulfilmentRow,
  mode: ShippingMode,
  now: number = Date.now(),
) {
  const dispatchable = DISPATCHABLE.has(row.status || "");
  const hasTracking = !!row.shipping_tracking_url;
  const hasAddress = !!(row.shipping_address && row.shipping_address.trim());

  let stage: FulfilmentStage;
  if (mode === "no") {
    stage = "not_applicable";
  } else if (row.product_received === true) {
    stage = "received";
  } else if (row.product_received === false) {
    stage = "not_received";
  } else if (hasTracking) {
    stage = "shipped";
  } else if (mode === "pickup" || hasAddress) {
    // Pickup never needs an address from the creator — the brand's pickup
    // address is on the campaign, so such a row is ready the moment it is
    // approved.
    stage = "ready_to_ship";
  } else {
    stage = "awaiting_address";
  }

  // The reminder, computed rather than scheduled: shipped, past the date it
  // should have arrived, and the creator still hasn't said either way.
  const expectedMs = row.shipping_expected_at ? new Date(row.shipping_expected_at).getTime() : null;
  const receiptOverdue = stage === "shipped" && expectedMs !== null && expectedMs < now;
  const daysOverdue = receiptOverdue && expectedMs ? Math.floor((now - expectedMs) / 86_400_000) : 0;

  return {
    stage,
    mode,
    // Chase the creator for an address: we ship, they're in, and we still
    // don't know where.
    needsAddress: mode === "yes" && dispatchable && !hasAddress,
    // Already chased — the ask is recorded so nobody asks twice.
    addressRequested: !!row.shipping_address_requested_at,
    // Mirrors the DB trigger in migration 076: after dispatch a new address
    // is a lie, so the UI must not offer it either.
    canEditAddress: !hasTracking,
    canAddTracking: mode !== "no" && dispatchable,
    receiptOverdue,
    daysOverdue,
    expectedAt: row.shipping_expected_at,
  };
}

// When the product should be with them: dispatch + the campaign's promise.
export function expectedArrival(fromIso: string, timelineDays: number | null | undefined): string {
  const days = Number(timelineDays) > 0 ? Number(timelineDays) : DEFAULT_SHIPPING_DAYS;
  return new Date(new Date(fromIso).getTime() + days * 86_400_000).toISOString();
}

export const STAGE_LABEL: Record<FulfilmentStage, string> = {
  not_applicable: "No delivery",
  awaiting_address: "Awaiting address",
  ready_to_ship: "Ready to ship",
  shipped: "Shipped",
  received: "Delivered",
  not_received: "Not received",
};

export const STAGE_STYLE: Record<FulfilmentStage, string> = {
  not_applicable: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  awaiting_address: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  ready_to_ship: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  shipped: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  received: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  not_received: "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};
