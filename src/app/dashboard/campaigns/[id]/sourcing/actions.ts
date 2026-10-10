"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin, requireSuperAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { clampLen, isHttpUrl } from "@/lib/validation";
import { ensureInvitation, normalizeHandle } from "@/lib/sourcing/ensure-invitation";
import { logBookingEvent } from "@/lib/sourcing/booking-events";
import {
  PAYOUT_ON_ENTER,
  canTransition,
  isBookingStage,
  toFulfilmentMode,
  type BookingStage,
  type FulfilmentMode,
} from "@/lib/sourcing/stages";

// Managed sourcing, admin side. Tables come from rgossips_web migration 081.
//
// Two rules hold this together:
//
//  1. Every booking created here also becomes an invited influencer, so a
//     creator we sourced by hand is in the creator database afterwards.
//  2. Money is queued by stage transitions, never typed directly. Approving
//     a receipt queues the reimbursement; recording the go-live queues the
//     fee at +48h. An admin cannot create a payout by hand at all.

const NAME_MAX = 120;
const ADDRESS_MAX = 600;
const NOTE_MAX = 2000;
const CARRIER_MAX = 60;

// Admins type rupees; the column is paise. One conversion point, because the
// table next door mixes the two and that is exactly the bug to avoid.
function toPaise(rupees: unknown): number | null {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Timeline writes moved to lib/sourcing/booking-events.ts so the historical
// import writes them the same way — see `logBookingEvent` in the imports.
const logEvent = logBookingEvent;

export type BookingInput = {
  campaignId: string;
  instagramUsername: string;
  creatorName?: string;
  email?: string;
  phone?: string;
  shippingAddress?: string;
  tier?: string;
  categoryRaw?: string;
  followersCount?: number | null;
  quotedFee?: number | null;
  agreedFee?: number | null;
  productCost?: number | null;
  notes?: string;
  // Who gets the product to them. Defaults to reimburse, which is what the
  // original manual process did.
  fulfilmentMode?: FulfilmentMode;
  // The admin who owns reaching out to this creator. Assigned at creation
  // because an unassigned row is one nobody is responsible for, which is
  // the failure the outreach tracker exists to stop.
  assignTo?: string | null;
};

export async function addBooking(
  input: BookingInput,
): Promise<{ error?: string; success?: boolean; bookingId?: string; creatorOutcome?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const handle = normalizeHandle(input.instagramUsername);
  if (!handle) return { error: "Enter the creator's Instagram handle." };

  const admin = createAdminClient();

  // The creator enters the database first. If this fails we do NOT write a
  // booking — a booking with no creator record behind it is the spreadsheet
  // problem all over again.
  const ensured = await ensureInvitation(
    admin,
    {
      instagramUsername: handle,
      fullName: input.creatorName || null,
      // category_raw is the brand's wording and must NOT become a canonical
      // category: those drive campaign matching.
      note: input.notes || null,
    },
    actorId,
  );
  if (ensured.outcome === "error") return { error: ensured.error || "Could not record the creator." };

  const { data, error } = await admin
    .from("campaign_bookings")
    .insert({
      campaign_id: input.campaignId,
      influencer_id: ensured.influencerId,
      invitation_id: ensured.invitationId,
      instagram_username: handle,
      creator_name: clampLen(input.creatorName || "", NAME_MAX) || null,
      email: clampLen(input.email || "", 200) || null,
      phone: clampLen(input.phone || "", 40) || null,
      shipping_address: clampLen(input.shippingAddress || "", ADDRESS_MAX) || null,
      tier: clampLen(input.tier || "", 40) || null,
      category_raw: clampLen(input.categoryRaw || "", 120) || null,
      followers_count: Number.isFinite(Number(input.followersCount)) ? Number(input.followersCount) : null,
      quoted_fee_paise: toPaise(input.quotedFee),
      agreed_fee_paise: toPaise(input.agreedFee),
      product_cost_paise: toPaise(input.productCost),
      notes: clampLen(input.notes || "", NOTE_MAX) || null,
      fulfilment_mode: toFulfilmentMode(input.fulfilmentMode),
      stage: "shortlisted",
      // Spread so these keys are absent entirely when nobody was picked:
      // they only exist once rgossips_web migration 084 is applied, and
      // naming a missing column fails the whole insert.
      ...(input.assignTo
        ? {
            assigned_to: input.assignTo,
            assigned_at: new Date().toISOString(),
            assigned_by: actorId,
            outreach_owner: input.assignTo,
          }
        : {}),
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    if (String(error.code) === "23505") {
      return { error: `@${handle} is already on this campaign's sourcing list.` };
    }
    return { error: friendlyDbError("sourcing.add", error, "Could not add the creator. Please try again.", { handle }) };
  }

  await logEvent(admin, data.id, {
    kind: "note",
    note: `Added to sourcing (${ensured.outcome === "created" ? "new invitation" : ensured.outcome})`,
    actor_id: actorId,
  });

  revalidatePath(`/dashboard/campaigns/${input.campaignId}/sourcing`);
  return { success: true, bookingId: data.id, creatorOutcome: ensured.outcome };
}

export async function advanceBookingStage(
  bookingId: string,
  to: string,
  extra?: { note?: string; liveUrl?: string },
): Promise<{ error?: string; success?: boolean; queuedPayout?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!isBookingStage(to)) return { error: "Unknown stage." };

  const admin = createAdminClient();
  const { data: booking, error: readErr } = await admin
    .from("campaign_bookings")
    .select("id, campaign_id, stage, agreed_fee_paise, product_cost_paise, instagram_username, fulfilment_mode")
    .eq("id", bookingId)
    .maybeSingle();
  if (readErr) return { error: friendlyDbError("sourcing.stage.read", readErr, "Could not load the booking.", { bookingId }) };
  if (!booking) return { error: "Booking not found." };

  const from = booking.stage as BookingStage;
  if (from === to) return { success: true };
  // The ladder is enforced here, not just drawn in the UI: a forced stage
  // queues money, so an out-of-order jump needs the escape hatch below.
  const mode = toFulfilmentMode(booking.fulfilment_mode);
  if (!canTransition(from, to, mode)) {
    return { error: `Cannot go from "${from}" to "${to}". Use the override if this is a correction.` };
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { stage: to, updated_at: now };
  if (to === "contacted") updates.contacted_at = now;
  if (to === "price_agreed") updates.price_agreed_at = now;
  if (to === "confirmed") updates.confirmed_at = now;
  if (to === "product_approved") {
    updates.receipt_approved_at = now;
    updates.receipt_approved_by = actorId;
  }
  if (to === "product_delivered") {
    updates.product_received = true;
    updates.product_received_at = now;
  }
  if (to === "script_shared") updates.script_shared_at = now;
  if (to === "admin_approved") {
    updates.admin_approved_at = now;
    updates.admin_approved_by = actorId;
  }
  if (to === "brand_approved") {
    updates.brand_approved_at = now;
    updates.brand_approved_by = actorId;
  }
  if (to === "revision_needed" && extra?.note) updates.admin_revision_note = clampLen(extra.note, NOTE_MAX);
  if (to === "live") {
    if (extra?.liveUrl) {
      if (!isHttpUrl(extra.liveUrl)) return { error: "That live link doesn't look like a URL." };
      updates.live_url = clampLen(extra.liveUrl, 500);
    }
    updates.live_at = now;
  }

  const { error } = await admin.from("campaign_bookings").update(updates).eq("id", bookingId).eq("stage", from);
  if (error) return { error: friendlyDbError("sourcing.stage.write", error, "Could not update the stage.", { bookingId, to }) };

  await logEvent(admin, bookingId, { kind: "stage_change", from_stage: from, to_stage: to, actor_id: actorId, note: extra?.note || null });

  // Money is queued by the transition, never typed in.
  let queuedPayout: string | undefined;
  const leg = PAYOUT_ON_ENTER[to];
  if (leg) {
    const amount = leg.kind === "fee" ? booking.agreed_fee_paise : booking.product_cost_paise;
    if (!amount || amount <= 0) {
      logError("sourcing.payout.noamount", new Error("stage entered with no amount"), { bookingId, kind: leg.kind });
    } else {
      const releaseAt = new Date(Date.now() + leg.dueAfterHours * 3_600_000).toISOString();
      const { error: payErr } = await admin.from("campaign_booking_payouts").insert({
        booking_id: bookingId,
        kind: leg.kind,
        amount_paise: amount,
        payout_status: "scheduled",
        payout_release_at: releaseAt,
      });
      // 23505 = the leg already exists, which is a double-clicked button and
      // not a problem. The unique index is what makes that safe.
      if (payErr && String(payErr.code) !== "23505") {
        logError("sourcing.payout.queue", payErr, { bookingId, kind: leg.kind });
      } else if (!payErr) {
        queuedPayout = leg.kind;
        await logEvent(admin, bookingId, { kind: "payout", note: `${leg.kind} queued for ${releaseAt}`, actor_id: actorId });
      }
    }
  }

  revalidatePath(`/dashboard/campaigns/${booking.campaign_id}/sourcing`);
  revalidatePath("/dashboard/payouts");
  return { success: true, queuedPayout };
}

// The escape hatch. Super-admin only, and stricter than the equivalent on
// applications: a forced stage here can queue a payment.
export async function setBookingStage(
  bookingId: string,
  to: string,
): Promise<{ error?: string; success?: boolean }> {
  let actorId: string;
  try {
    actorId = await requireSuperAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!isBookingStage(to)) return { error: "Unknown stage." };

  const admin = createAdminClient();
  const { data: booking } = await admin.from("campaign_bookings").select("campaign_id, stage").eq("id", bookingId).maybeSingle();
  if (!booking) return { error: "Booking not found." };

  const { error } = await admin
    .from("campaign_bookings")
    .update({ stage: to, updated_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) return { error: friendlyDbError("sourcing.force", error, "Could not set the stage.", { bookingId }) };

  await logEvent(admin, bookingId, { kind: "stage_change", from_stage: booking.stage, to_stage: to, note: "forced by super admin", actor_id: actorId });
  await auditLog("booking_stage_override", actorId, `${bookingId} ${booking.stage} -> ${to}`);
  revalidatePath(`/dashboard/campaigns/${booking.campaign_id}/sourcing`);
  return { success: true };
}

export async function updateBookingFields(
  bookingId: string,
  fields: { email?: string; phone?: string; shippingAddress?: string; quotedFee?: number | null; agreedFee?: number | null; productCost?: number | null; notes?: string },
): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.email !== undefined) updates.email = clampLen(fields.email, 200) || null;
  if (fields.phone !== undefined) updates.phone = clampLen(fields.phone, 40) || null;
  if (fields.shippingAddress !== undefined) updates.shipping_address = clampLen(fields.shippingAddress, ADDRESS_MAX) || null;
  if (fields.quotedFee !== undefined) updates.quoted_fee_paise = toPaise(fields.quotedFee);
  if (fields.agreedFee !== undefined) updates.agreed_fee_paise = toPaise(fields.agreedFee);
  if (fields.productCost !== undefined) updates.product_cost_paise = toPaise(fields.productCost);
  if (fields.notes !== undefined) updates.notes = clampLen(fields.notes, NOTE_MAX) || null;

  const { data, error } = await admin.from("campaign_bookings").update(updates).eq("id", bookingId).select("campaign_id").single();
  if (error) return { error: friendlyDbError("sourcing.update", error, "Could not save. Please try again.", { bookingId }) };

  revalidatePath(`/dashboard/campaigns/${data.campaign_id}/sourcing`);
  return { success: true };
}

// When the trigger misses — a creator who signed up with a different handle,
// say — an admin can bind the booking by hand.
export async function linkBookingToCreator(
  bookingId: string,
  influencerId: string,
): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaign_bookings")
    .update({ influencer_id: influencerId, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .select("campaign_id")
    .single();
  if (error) return { error: friendlyDbError("sourcing.link", error, "Could not link the creator.", { bookingId }) };

  revalidatePath(`/dashboard/campaigns/${data.campaign_id}/sourcing`);
  return { success: true };
}

// Tracking for a booking we are shipping ourselves. Mirrors the barter
// fulfilment action on applications — same fields, same reasoning — but
// against campaign_bookings, where the creator may have no account at all.
export async function setBookingTracking(
  bookingId: string,
  trackingUrl: string,
  carrier?: string,
  expectedDays?: number,
): Promise<{ error?: string; success?: boolean }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const url = clampLen(trackingUrl, 500);
  if (!url) return { error: "Enter the tracking link." };
  if (!isHttpUrl(url)) return { error: "That doesn't look like a link — it should start with http:// or https://" };

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("campaign_bookings")
    .select("campaign_id, fulfilment_mode, shipping_address")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found." };
  if (toFulfilmentMode(booking.fulfilment_mode) !== "ship") {
    return { error: "This creator is buying the product themselves — there is nothing to track." };
  }
  if (!booking.shipping_address) return { error: "Add the delivery address first — there's nowhere to send it." };

  const now = new Date();
  const days = Number(expectedDays) > 0 ? Number(expectedDays) : 5;
  const { error } = await admin
    .from("campaign_bookings")
    .update({
      shipping_tracking_url: url,
      shipping_carrier: carrier ? clampLen(carrier, CARRIER_MAX) || null : null,
      shipping_tracking_added_at: now.toISOString(),
      shipping_tracking_added_by: actorId,
      shipping_expected_at: new Date(now.getTime() + days * 86_400_000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", bookingId);
  if (error) return { error: friendlyDbError("sourcing.tracking", error, "Could not save the tracking link.", { bookingId }) };

  await logEvent(admin, bookingId, { kind: "note", note: `Tracking added${carrier ? ` (${carrier})` : ""}`, actor_id: actorId });
  revalidatePath(`/dashboard/campaigns/${booking.campaign_id}/sourcing`);
  return { success: true };
}
