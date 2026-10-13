"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin, getAdminProfile } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { clampLen, isHttpUrl } from "@/lib/validation";
import { logBookingEvent } from "@/lib/sourcing/booking-events";
import {
  MOVES,
  canAct,
  canDrop,
  dropNeedsReason,
  moveNeedsApprover,
  movesFrom,
  type ActorContext,
  type MoveId,
} from "@/lib/sourcing/outreach";

// Every write the outreach tracker makes.
//
// ONE mover rather than an action per transition: the stage decides what is
// allowed (movesFrom), the move decides where it goes (MOVES), and this
// just validates and writes. An action per button meant twelve near-copies
// of the same gate, re-read and audit code.
//
// Each one re-reads the booking server-side and scopes it to the campaign:
// a booking id from a stale page must not move a row on another campaign.

const NOTE_MAX = 1000;

function toPaise(rupees: unknown): number | null {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

const UNDEFINED_COLUMN = "42703";
function notLiveYet(scope: string, error: { code?: string } | null): string | null {
  if (error && String(error.code) === UNDEFINED_COLUMN) {
    logError(scope, error, { hint: "migration 085 not applied" });
    return "The outreach tracker needs database migration 085 applied before it can record this.";
  }
  return null;
}

export type AssignableAdmin = { id: string; name: string; email: string; isApprover: boolean };

export async function listAssignableAdmins(): Promise<{ error?: string; admins?: AssignableAdmin[] }> {
  const gate = await adminGate();
  if (gate) return gate;
  // select("*") on purpose: is_outreach_approver only exists once admin
  // migration 005 is applied, and naming a missing column fails the query.
  const { data, error } = await createAdminClient().from("admin_profiles").select("*");
  if (error) {
    logError("outreach.listAdmins", error, {});
    return { error: "Could not load the admin list." };
  }
  const admins = (data || [])
    .filter((a) => a.role === "admin" || a.role === "super_admin")
    .map((a) => ({
      id: String(a.id),
      name: String(a.full_name || a.email || "Unnamed admin"),
      email: String(a.email || ""),
      isApprover: a.is_outreach_approver === true,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));
  return { admins };
}

/** Falls back to super_admins when nobody holds the approver flag. */
async function resolveApprovers(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from("admin_profiles").select("*");
  const rows = data || [];
  const flagged = rows.filter((a) => a.is_outreach_approver === true).map((a) => String(a.id));
  if (flagged.length) return flagged;
  return rows.filter((a) => a.role === "super_admin").map((a) => String(a.id));
}

async function actorContext(actorId: string, admin: ReturnType<typeof createAdminClient>): Promise<ActorContext> {
  const profile = await getAdminProfile();
  const approvers = await resolveApprovers(admin);
  return {
    actorId,
    name: profile?.fullName || "an admin",
    isSuperAdmin: profile?.role === "super_admin",
    isApprover: approvers.includes(actorId),
    isViewer: profile?.role === "viewer",
  };
}

export type MovePayload = {
  quote?: number | null;
  reimb?: number | null;
  channel?: string;
  link?: string;
  note?: string;
  mode?: string;
  barter?: string;
};

export type MoveResult = { error?: string; success?: boolean };

/**
 * Move one booking along the pipeline.
 *
 * The move must be offered by the stage the booking is actually in — read
 * from the database, not from whatever the page was showing. That is what
 * stops two admins on the same row from both "approving" a quote, and what
 * makes a stale tab harmless.
 */
export async function moveBooking(
  campaignId: string,
  bookingId: string,
  move: string,
  payload: MovePayload = {},
): Promise<MoveResult> {
  const gate = await adminGate();
  if (gate) return gate;
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!(move in MOVES)) return { error: "Unknown action." };
  const moveId = move as MoveId;

  const admin = createAdminClient();
  const { data: booking, error: readErr } = await admin
    .from("campaign_bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (readErr || !booking) return { error: "Could not find that creator on this campaign." };

  const actor = await actorContext(actorId, admin);

  // The stage on the ROW decides what is possible, so a stale page cannot
  // replay a move that has already happened.
  const offered =
    moveId === "dropCreator" ? canDrop(booking) : movesFrom(String(booking.stage)).includes(moveId);
  if (!offered) {
    return { error: "That's not available any more — someone may have moved this already. Refresh and look again." };
  }
  if (!canAct(booking, actor)) {
    return { error: "This step belongs to someone else." };
  }
  if (moveNeedsApprover(moveId) && !actor.isApprover && !actor.isSuperAdmin) {
    return { error: "Only an approver can reopen a dropped creator." };
  }

  const spec = MOVES[moveId];
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { stage: spec.to, updated_at: now };
  let detail = "";

  switch (moveId) {
    case "approveCreator": {
      // The approver can confirm or change what was suggested.
      const paise = toPaise(payload.quote);
      if (paise) updates.quoted_fee_paise = paise;
      const shown = paise ?? booking.quoted_fee_paise;
      detail = shown ? `, quote Rs ${Math.round(Number(shown) / 100).toLocaleString("en-IN")}` : "";
      break;
    }
    case "markReached": {
      const channel = clampLen(payload.channel || "", 40);
      if (!channel) return { error: "Say how you reached out." };
      updates.contacted_channel = channel;
      updates.contacted_at = now;
      detail = ` via ${channel}`;
      break;
    }
    case "submitQuote": {
      const paise = toPaise(payload.quote);
      if (!paise) return { error: "Enter the quote the creator agreed to." };
      updates.agreed_fee_paise = paise;
      updates.price_agreed_at = now;
      detail = ` Rs ${Math.round(paise / 100).toLocaleString("en-IN")}`;
      break;
    }
    case "approveQuote": {
      updates.confirmed_at = now;
      const agreed = booking.agreed_fee_paise;
      detail = agreed ? ` Rs ${Math.round(Number(agreed) / 100).toLocaleString("en-IN")}` : "";
      if (payload.note?.trim()) detail += ` · ${clampLen(payload.note, NOTE_MAX)}`;
      break;
    }
    case "negotiate": {
      // Clear the agreed figure: it was not accepted, and leaving it would
      // show a price nobody signed off as though it stood.
      updates.agreed_fee_paise = null;
      if (payload.note?.trim()) detail = `: ${clampLen(payload.note, NOTE_MAX)}`;
      break;
    }
    case "markReimbursed": {
      const paise = toPaise(payload.reimb);
      if (!paise) return { error: "Enter the amount reimbursed." };
      updates.product_cost_paise = paise;
      detail = ` Rs ${Math.round(paise / 100).toLocaleString("en-IN")}`;
      break;
    }
    case "submitContent": {
      const link = (payload.link || "").trim();
      if (!link) return { error: "Add the link to the submitted content." };
      if (!isHttpUrl(link)) return { error: "That link doesn't look like a URL." };
      updates.live_url = clampLen(link, 600);
      updates.live_at = now;
      break;
    }
    case "approveContent": {
      updates.admin_approved_at = now;
      updates.admin_approved_by = actorId;
      if (payload.note?.trim()) detail = ` · ${clampLen(payload.note, NOTE_MAX)}`;
      break;
    }
    case "requestChanges": {
      const note = clampLen(payload.note || "", NOTE_MAX);
      if (!note.trim()) return { error: "Say what should change — the owner needs to know." };
      updates.admin_revision_note = note;
      detail = `: ${note}`;
      break;
    }
    case "closeDeal": {
      const mode = payload.mode === "Barter" ? "Barter" : payload.mode === "Cash" ? "Cash" : "";
      if (!mode) return { error: "Pick how this is being settled." };
      updates.payout_mode = mode;
      if (mode === "Barter") {
        const what = clampLen(payload.barter || "", 300).trim();
        if (!what) return { error: "Say what was sent instead of payment." };
        updates.payout_detail = what;
        detail = ` with barter: ${what}`;
      } else {
        updates.payout_detail = null;
        const agreed = booking.agreed_fee_paise;
        detail = agreed ? `: paid Rs ${Math.round(Number(agreed) / 100).toLocaleString("en-IN")}` : "";
      }
      break;
    }
    case "dropCreator": {
      // A reason is required once there was something to lose. The note is
      // the only record of why a committed creator stopped, and it is kept
      // on the row as well as in the timeline so it is visible without
      // opening the history.
      const reason = clampLen(payload.note || "", NOTE_MAX).trim();
      if (dropNeedsReason(booking) && !reason) {
        return { error: "Add a reason — this creator was already past quote approval." };
      }
      updates.outreach_note = reason || null;
      detail = reason ? `: ${reason}` : "";
      break;
    }
    case "reopen": {
      // Back to the start of the team's half, with the quote cleared — the
      // old agreement died with the drop.
      updates.agreed_fee_paise = null;
      updates.contacted_channel = null;
      break;
    }
    default:
      break;
  }

  const { error } = await admin
    .from("campaign_bookings")
    .update(updates)
    .eq("id", bookingId)
    .eq("campaign_id", campaignId);

  const migrationMsg = notLiveYet("outreach.move", error);
  if (migrationMsg) return { error: migrationMsg };
  if (error) return { error: friendlyDbError("outreach.move", error, "Could not save that") };

  await logBookingEvent(admin, bookingId, {
    kind: "stage_change",
    from_stage: String(booking.stage),
    to_stage: spec.to,
    note: `${spec.verb}${detail}`,
    actor_id: actorId,
  });

  // Money moves and the decisions that lead to them go in the activity log
  // AND the admin audit log — the first is for the team, the second is for
  // whoever asks later who approved what.
  if (["approveQuote", "markReimbursed", "closeDeal", "approveCreator", "dropCreator"].includes(moveId)) {
    await auditLog("outreach_move", actorId, `${campaignId}/${bookingId}: ${spec.verb}${detail}`);
  }

  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  return { success: true };
}

/** Hand a creator to a team member (or move them between them). */
export async function assignBooking(
  campaignId: string,
  bookingId: string,
  adminId: string,
): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!bookingId || !adminId) return { error: "Pick an admin to assign this to." };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("campaign_bookings")
    .update({ assigned_to: adminId, assigned_at: now, assigned_by: actorId, outreach_owner: adminId, updated_at: now })
    .eq("id", bookingId)
    .eq("campaign_id", campaignId);

  const migrationMsg = notLiveYet("outreach.assign", error);
  if (migrationMsg) return { error: migrationMsg };
  if (error) return { error: friendlyDbError("outreach.assign", error, "Could not assign this creator") };

  const to = (await listAssignableAdmins()).admins?.find((a) => a.id === adminId);
  await logBookingEvent(admin, bookingId, {
    kind: "note",
    note: `assigned to ${to?.name || "an admin"}`,
    actor_id: actorId,
  });
  await auditLog("outreach_assign", actorId, `${campaignId}/${bookingId}: -> ${to?.name || adminId}`);
  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  return { success: true };
}

export type DeleteBookingResult = { error?: string; success?: boolean };

/**
 * Remove a creator from the tracker entirely.
 *
 * super_admins and approvers only. Dropping a creator records that we
 * approached them and it did not work; deleting erases that we ever did,
 * which should not be a one-click escape from an awkward row.
 *
 * The booking, its timeline and any payout rows go (the last two by ON
 * DELETE CASCADE). The influencer_invitations row STAYS — the creator is in
 * our database on their own merit, and removing a booking is not a reason
 * to un-invite somebody.
 */
export async function deleteBooking(campaignId: string, bookingId: string): Promise<DeleteBookingResult> {
  const gate = await adminGate();
  if (gate) return gate;
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const admin = createAdminClient();
  const actor = await actorContext(actorId, admin);
  if (!actor.isSuperAdmin && !actor.isApprover) {
    return { error: "Only a super admin or an approver can remove a creator from the tracker." };
  }

  const { data: booking } = await admin
    .from("campaign_bookings")
    .select("instagram_username, stage, agreed_fee_paise")
    .eq("id", bookingId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (!booking) return { error: "That creator is not on this campaign." };

  const { error } = await admin
    .from("campaign_bookings")
    .delete()
    .eq("id", bookingId)
    .eq("campaign_id", campaignId);
  if (error) {
    logError("outreach.delete", error, { campaignId, bookingId });
    return { error: friendlyDbError("outreach.delete", error, "Could not remove them") };
  }

  await auditLog(
    "outreach_booking_delete",
    actorId,
    `${campaignId}: removed @${booking.instagram_username} at ${booking.stage}` +
      `${booking.agreed_fee_paise ? ` (Rs ${Math.round(Number(booking.agreed_fee_paise) / 100)})` : ""}`,
  );
  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  return { success: true };
}
