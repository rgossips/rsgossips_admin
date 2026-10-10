"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin, getAdminProfile } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { clampLen } from "@/lib/validation";
import { ensureInvitation } from "@/lib/sourcing/ensure-invitation";
import { logBookingEvent } from "@/lib/sourcing/booking-events";
import {
  canDecideApproval,
  canRecordOutcome,
  isOutreachStatus,
  stageForApproval,
  stageForOutreach,
  type ActorContext,
  type OutreachStatus,
} from "@/lib/sourcing/outreach";

// The outreach tracker's writes.
//
// The flow these four actions implement:
//
//   1. A creator is added and ASSIGNED to an admin. That admin owns getting
//      hold of them.
//   2. That admin records what happened: not picked up, declined, or an
//      amount agreed.
//   3. An agreed amount moves the row to the APPROVER automatically. The
//      negotiator does not sign off on their own price.
//   4. The approver approves (the creator enters the creator database and an
//      application is created), sends it back to the negotiator, or rejects
//      the price with a note.
//
// Every one re-reads the booking server-side and scopes it to the campaign:
// a booking id from a stale page must not be able to move a row on another
// campaign.

const NOTE_MAX = 1000;

// Rupees in, paise out. Same single conversion point as the other sourcing
// actions, for the same reason.
function toPaise(rupees: unknown): number | null {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// Postgres "column does not exist". The outreach columns arrive with
// rgossips_web migration 084, so until that is applied every write here
// fails — and it should say so rather than surfacing raw SQL.
const UNDEFINED_COLUMN = "42703";

function notLiveYet(scope: string, error: { code?: string } | null): string | null {
  if (error && String(error.code) === UNDEFINED_COLUMN) {
    logError(scope, error, { hint: "migration 084 not applied" });
    return "The outreach tracker needs database migration 084 applied before it can record this.";
  }
  return null;
}

export type AssignableAdmin = { id: string; name: string; email: string; isApprover: boolean };

/**
 * Admins a creator can be assigned to.
 *
 * Viewers are excluded: assignment is a job with actions attached, and every
 * one of those actions would reject them at the gate, so offering them in
 * the dropdown would only create rows nobody can move.
 */
export async function listAssignableAdmins(): Promise<{ error?: string; admins?: AssignableAdmin[] }> {
  const gate = await adminGate();
  if (gate) return gate;

  // select("*") on purpose: is_outreach_approver only exists once admin
  // migration 005 is applied, and naming a missing column fails the whole
  // query (the same trap the applicant export documents).
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

/** Who signs off. Falls back to super_admins when nobody holds the flag. */
async function resolveApprovers(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ ids: string[]; viaFallback: boolean }> {
  const { data } = await admin.from("admin_profiles").select("*");
  const rows = data || [];
  const flagged = rows.filter((a) => a.is_outreach_approver === true).map((a) => String(a.id));
  if (flagged.length) return { ids: flagged, viaFallback: false };
  // Nobody is designated (migration 005 not applied, or the flag was
  // cleared). Routing to super_admins keeps the queue moving instead of
  // parking every agreed price with nobody able to release it.
  return {
    ids: rows.filter((a) => a.role === "super_admin").map((a) => String(a.id)),
    viaFallback: true,
  };
}

async function actorContext(actorId: string, admin: ReturnType<typeof createAdminClient>): Promise<ActorContext> {
  const profile = await getAdminProfile();
  const { ids } = await resolveApprovers(admin);
  return {
    actorId,
    isSuperAdmin: profile?.role === "super_admin",
    isApprover: ids.includes(actorId),
  };
}

/** Hand a creator to an admin (or move them between admins). */
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
    .update({
      assigned_to: adminId,
      assigned_at: now,
      assigned_by: actorId,
      // The negotiator of record, so a later "send back" knows where to.
      outreach_owner: adminId,
      updated_at: now,
    })
    .eq("id", bookingId)
    .eq("campaign_id", campaignId);

  const migrationMsg = notLiveYet("outreach.assign", error);
  if (migrationMsg) return { error: migrationMsg };
  if (error) return { error: friendlyDbError("outreach.assign", error, "Could not assign this creator") };

  const to = (await listAssignableAdmins()).admins?.find((a) => a.id === adminId);
  await logBookingEvent(admin, bookingId, {
    kind: "note",
    note: `Assigned to ${to?.name || "an admin"}`,
    actor_id: actorId,
  });
  await auditLog("outreach_assign", actorId, `${campaignId}/${bookingId}: -> ${to?.name || adminId}`);
  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  return { success: true };
}

/**
 * The assigned admin records what the creator said.
 *
 * An agreed amount is the only outcome that moves the row: it goes to the
 * approver, and the agreed fee is written at the same time so the two can
 * never disagree about what is being approved.
 */
export async function recordOutreachOutcome(
  campaignId: string,
  bookingId: string,
  status: string,
  agreedRupees?: number | null,
  note?: string,
): Promise<{ error?: string; success?: boolean; wentForApproval?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!isOutreachStatus(status)) return { error: "Unknown outreach outcome." };

  const admin = createAdminClient();
  const { data: booking, error: readErr } = await admin
    .from("campaign_bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (readErr || !booking) return { error: "Could not find that creator on this campaign." };

  const actor = await actorContext(actorId, admin);
  if (!canRecordOutcome(booking, actor)) {
    return { error: "This creator is assigned to another admin. Ask them to update it, or reassign it first." };
  }

  const outcome = status as OutreachStatus;
  const agreedPaise = toPaise(agreedRupees);
  if (outcome === "agreed" && agreedPaise === null) {
    return { error: "Enter the agreed amount before marking it agreed." };
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    outreach_status: outcome,
    outreach_updated_at: now,
    outreach_note: clampLen(note || "", NOTE_MAX) || null,
    stage: stageForOutreach(outcome),
    updated_at: now,
  };

  // Any outcome OTHER than "agreed" means there is no price on the table,
  // so a sign-off left over from a previous answer is cleared. This matters
  // because a super_admin can correct a settled row: without it, changing
  // "agreed" back to "not picked up" would leave approval_state reading
  // "approved" against a booking nobody agreed to.
  //
  // NOTE: it does NOT undo an application that an earlier approval created.
  // A creator who may already be filming should not be silently un-approved
  // by an admin fixing a typo — reversing that is a decision on the
  // applications list, where it is visible and notifies them.
  if (outcome !== "agreed") {
    updates.approval_state = null;
    updates.approval_decided_by = null;
    updates.approval_decided_at = null;
    updates.approval_note = null;
    // Back to whoever was negotiating, if it had gone up for sign-off.
    if (booking.outreach_owner) updates.assigned_to = booking.outreach_owner;
  }

  // An agreed price goes up for sign-off, and the row leaves the
  // negotiator's desk. outreach_owner is left alone so it can come back.
  let wentForApproval = false;
  if (outcome === "agreed") {
    updates.agreed_fee_paise = agreedPaise;
    updates.price_agreed_at = now;
    const { ids } = await resolveApprovers(admin);
    // Keep it with the negotiator if there is genuinely nobody to send it to,
    // rather than assigning it to null and losing it.
    if (ids.length) {
      updates.approval_state = "pending";
      updates.assigned_to = ids[0];
      updates.assigned_at = now;
      updates.assigned_by = actorId;
      wentForApproval = true;
    }
  }

  const { error } = await admin
    .from("campaign_bookings")
    .update(updates)
    .eq("id", bookingId)
    .eq("campaign_id", campaignId);

  const migrationMsg = notLiveYet("outreach.outcome", error);
  if (migrationMsg) return { error: migrationMsg };
  if (error) return { error: friendlyDbError("outreach.outcome", error, "Could not save that outcome") };

  await logBookingEvent(admin, bookingId, {
    kind: "stage_change",
    from_stage: String(booking.stage || ""),
    to_stage: String(updates.stage),
    note:
      outcome === "agreed"
        ? `Agreed Rs ${Number(agreedRupees).toLocaleString()}${wentForApproval ? " — sent for sign-off" : ""}`
        : `Outreach: ${outcome.replace(/_/g, " ")}`,
    actor_id: actorId,
  });

  await auditLog(
    "outreach_outcome",
    actorId,
    `${campaignId}/${bookingId}: ${outcome}` +
      `${outcome === "agreed" ? ` at Rs ${Number(agreedRupees).toLocaleString()}` : ""}` +
      `${wentForApproval ? " — sent for sign-off" : ""}`,
  );

  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  return { success: true, wentForApproval };
}

export type ApprovalDecision = "approved" | "rejected" | "renegotiate";

export type ApprovalResult = {
  error?: string;
  success?: boolean;
  /** An application was created, so the creator now shows in the campaign's applications. */
  applicationCreated?: boolean;
  /** They entered the creator database but have no account, so no application is possible yet. */
  invitedOnly?: boolean;
  invitationCreated?: boolean;
};

/**
 * The approver's decision on an agreed price.
 *
 * On approval the creator enters the creator database if they are not in it
 * already, and an application is created for this campaign so they continue
 * in the normal applications flow.
 *
 * ONE HONEST LIMIT: `campaign_applications.influencer_id` is a FK to
 * `influencer_profiles`, so an application can only exist for a creator who
 * has an ACCOUNT. A sourced creator who has only ever been invited cannot
 * have one — there is no row for it to point at. Those are approved and
 * invited, and the result says `invitedOnly` so the UI can say so plainly
 * rather than implying an application appeared. The booking already carries
 * the agreed price and the approval, and migration 081's trigger binds it to
 * their profile the moment they claim the invitation.
 */
export async function decideApproval(
  campaignId: string,
  bookingId: string,
  decision: ApprovalDecision,
  note?: string,
): Promise<ApprovalResult> {
  const gate = await adminGate();
  if (gate) return gate;
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!["approved", "rejected", "renegotiate"].includes(decision)) {
    return { error: "Unknown decision." };
  }

  const admin = createAdminClient();
  const { data: booking, error: readErr } = await admin
    .from("campaign_bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (readErr || !booking) return { error: "Could not find that creator on this campaign." };

  const actor = await actorContext(actorId, admin);
  if (!canDecideApproval(booking, actor)) {
    if (booking.approval_state !== "pending") return { error: "This price is not waiting for sign-off." };
    if (booking.outreach_owner === actorId) {
      return { error: "You negotiated this price, so someone else has to sign it off." };
    }
    return { error: "Only an outreach approver can sign off on a price." };
  }

  const clean = clampLen(note || "", NOTE_MAX);
  if (decision === "rejected" && !clean) {
    return { error: "Add a note saying why the price was rejected — the negotiator needs to know." };
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    approval_state: decision,
    approval_decided_by: actorId,
    approval_decided_at: now,
    approval_note: clean || null,
    stage: stageForApproval(decision),
    updated_at: now,
  };

  // Sent back: it returns to whoever negotiated it, and the outcome is
  // cleared so they re-record it after talking to the creator again.
  if (decision === "renegotiate") {
    updates.assigned_to = booking.outreach_owner || booking.assigned_by || actorId;
    updates.assigned_at = now;
    updates.assigned_by = actorId;
    updates.outreach_status = null;
    updates.approval_state = "renegotiate";
  }
  if (decision === "approved") updates.confirmed_at = now;

  const { error } = await admin
    .from("campaign_bookings")
    .update(updates)
    .eq("id", bookingId)
    .eq("campaign_id", campaignId);

  const migrationMsg = notLiveYet("outreach.approval", error);
  if (migrationMsg) return { error: migrationMsg };
  if (error) return { error: friendlyDbError("outreach.approval", error, "Could not save that decision") };

  await auditLog(
    "outreach_price_decision",
    actorId,
    `${campaignId}/${bookingId}: ${decision}${booking.agreed_fee_paise ? ` at Rs ${Math.round(Number(booking.agreed_fee_paise) / 100)}` : ""}`,
  );
  await logBookingEvent(admin, bookingId, {
    kind: "stage_change",
    from_stage: String(booking.stage || ""),
    to_stage: String(updates.stage),
    note: `Price ${decision}${clean ? ` — ${clean}` : ""}`,
    actor_id: actorId,
  });

  if (decision !== "approved") {
    revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
    return { success: true };
  }

  // ── Approved: into the creator database, then into applications ────────
  let invitationCreated = false;
  let influencerId: string | null = booking.influencer_id ? String(booking.influencer_id) : null;

  if (!influencerId) {
    const ensured = await ensureInvitation(
      admin,
      {
        instagramUsername: String(booking.instagram_username || ""),
        fullName: booking.creator_name ? String(booking.creator_name) : null,
        note: "Added from the outreach tracker",
      },
      actorId,
    );
    if (ensured.outcome === "error") {
      // The approval itself stands; only the database entry failed, and
      // retrying the approval would re-run just this part.
      logError("outreach.approve.ensure", ensured.error, { bookingId });
      return { success: true, error: "Approved, but could not add them to the creator database. Try again." };
    }
    invitationCreated = ensured.outcome === "created";
    influencerId = ensured.influencerId;
    if (ensured.invitationId) {
      await admin.from("campaign_bookings").update({ invitation_id: ensured.invitationId }).eq("id", bookingId);
    }
    if (influencerId) {
      await admin.from("campaign_bookings").update({ influencer_id: influencerId }).eq("id", bookingId);
    }
  }

  if (!influencerId) {
    // Invited, but no account — so no application is possible yet. Said
    // plainly rather than silently doing nothing.
    revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
    return { success: true, invitedOnly: true, invitationCreated };
  }

  // "Waiting for deliverables" IS `approved`: its creator-facing copy is
  // already "You're approved. Check the brief and start creating." A brand
  // new status would read as "Applied" in the consumer app until that repo
  // ships a matching change, because its offers page clamps an unknown
  // status to the first rung of the ladder.
  const rupees = booking.agreed_fee_paise ? Math.round(Number(booking.agreed_fee_paise) / 100) : null;

  const { data: existing } = await admin
    .from("campaign_applications")
    .select("id, status")
    .eq("campaign_id", campaignId)
    .eq("influencer_id", influencerId)
    .maybeSingle();

  if (existing) {
    // They had already applied through the portal. Move that row forward
    // rather than inserting a second one, which the unique index refuses.
    await admin
      .from("campaign_applications")
      .update({ status: "approved", final_agreed_rate: rupees, updated_at: now })
      .eq("id", existing.id);
    await admin.from("campaign_bookings").update({ application_id: existing.id }).eq("id", bookingId);
  } else {
    const { data: created, error: appErr } = await admin
      .from("campaign_applications")
      .insert({
        campaign_id: campaignId,
        influencer_id: influencerId,
        status: "approved",
        final_agreed_rate: rupees,
        // The creator did not apply — an admin sourced them. Recorded so the
        // two intake paths stay distinguishable.
        initiated_by: "admin",
      })
      .select("id")
      .single();
    if (appErr) {
      logError("outreach.approve.application", appErr, { bookingId, influencerId });
      return {
        success: true,
        invitationCreated,
        error: "Approved, but the application could not be created. Check the campaign's applications.",
      };
    }
    if (created) {
      await admin.from("campaign_bookings").update({ application_id: created.id }).eq("id", bookingId);
    }
  }

  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  return { success: true, applicationCreated: true, invitationCreated };
}
