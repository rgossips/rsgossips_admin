"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog, enforceRateLimit } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { clampLen, isHttpUrl } from "@/lib/validation";
import { resolveHandles, type HandleKind } from "@/lib/sourcing/resolve-handles";
import { toFulfilmentMode, type FulfilmentMode } from "@/lib/sourcing/stages";
import { logBookingEvents } from "@/lib/sourcing/booking-events";
import {
  MAX_ROWS_PER_CALL,
  IMPORTABLE_STAGES,
  HISTORICAL_STAGES,
} from "@/lib/sourcing/import-constants";

// Bulk create for the sourcing list.
//
// The flow an admin sees is preview-then-confirm, and that is a deliberate
// two-action shape rather than one upload call: a sheet of 300 creators is
// a mix of people already on this campaign, people already in our database,
// and people we have never heard of — and the third group is the only one
// where importing WRITES something permanent outside the campaign (a new
// influencer_invitations row). Showing the split first is what makes that
// an admin's decision instead of a side effect.
//
// The classification shown in the preview is never trusted at import: the
// import re-resolves every handle server-side. A stale preview, a concurrent
// admin or a tampered payload therefore cannot create a duplicate
// invitation for someone who already has an account.

const NAME_MAX = 120;
const ADDRESS_MAX = 600;
const NOTE_MAX = 2000;

// Admins type rupees; the column is paise. Same single conversion point as
// actions.ts, for the same reason.
function toPaise(rupees: unknown): number | null {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export type ImportRowInput = {
  handle: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  tier?: string;
  category?: string;
  followers?: number | null;
  quotedFee?: number | null;
  agreedFee?: number | null;
  productCost?: number | null;
  notes?: string;
  stage?: string;
  // ── Historical extras ─────────────────────────────────────────────────
  //
  // Only the backfill sends these; every existing caller omits them and is
  // unaffected.
  //
  // Appended to `notes` AFTER clamping and never truncated. An import
  // marker has to survive intact — clamping prose that happened to be long
  // would cut the trailer off the end and the next run would read the row
  // as hand-built and refuse to touch it.
  notesSuffix?: string;
  liveUrl?: string;
  liveAt?: string | null;
  fulfilmentMode?: FulfilmentMode;
  revisionNote?: string;
  // Timestamps for the stage this row lands on, so a booking born at `live`
  // does not show a blank timeline and read as fabricated.
  contactedAt?: string | null;
  confirmedAt?: string | null;
  scriptSharedAt?: string | null;
};

// Which allowlist applies. `pipeline` is a live campaign being sourced now;
// `historical` is a finished one being recorded after the fact. Both are
// defined in import-constants.ts, and NEITHER contains a money stage.
const STAGE_SETS = {
  pipeline: new Set<string>(IMPORTABLE_STAGES),
  historical: new Set<string>(HISTORICAL_STAGES),
};

export type ClassifiedHandle = { handle: string; kind: HandleKind; knownName: string | null };

// Preview only — reads, writes nothing.
export async function classifySourcingHandles(
  campaignId: string,
  handles: string[],
): Promise<{ error?: string; classified?: ClassifiedHandle[] }> {
  try {
    await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!handles?.length) return { classified: [] };
  if (handles.length > 600) return { error: "Too many handles in one go." };

  const admin = createAdminClient();
  const { error, resolved } = await resolveHandles(admin, campaignId, handles);
  if (error || !resolved) return { error: error || "Could not check the creator database." };

  return {
    classified: [...resolved.values()].map((r) => ({ handle: r.handle, kind: r.kind, knownName: r.knownName })),
  };
}

export type ImportResult = {
  error?: string;
  added?: number;
  // Existing bookings refreshed from the sheet. Only possible with
  // onExisting: "update", and only for rows this import wrote before.
  updated?: number;
  // Already on this campaign's list AND built by hand, so left alone. A
  // re-run must never overwrite an admin's own work.
  skippedManual?: number;
  // Already on this campaign's list — not a failure, just nothing to do.
  skippedSourced?: number;
  // New creators the admin chose not to add to the database.
  skippedNew?: number;
  // Invitations created as a side effect of importing new creators.
  invitationsCreated?: number;
  // Live links the sheet carried that were not valid URLs. Dropped rather
  // than written, because a dead link reaches the brand's view too.
  droppedLinks?: number;
  failed?: { handle: string; reason: string }[];
};

export async function importSourcingRows(
  campaignId: string,
  rows: ImportRowInput[],
  opts: {
    createNew: boolean;
    fulfilmentMode?: FulfilmentMode;
    // Default "pipeline" keeps today's behaviour for every existing caller.
    allowStages?: "pipeline" | "historical";
    // Default "skip" keeps today's behaviour. "update" refreshes a booking
    // this import wrote before, which is what makes a re-run converge
    // instead of silently doing nothing.
    onExisting?: "skip" | "update";
    // Guard for "update": only a booking whose notes carry this marker may
    // be rewritten. A booking an admin built by hand carries no marker and
    // is skipped, counted as skippedManual. Without this, re-running an
    // import would flatten hand corrections.
    updateGuardKey?: string;
    // Provenance line for each imported booking's timeline.
    importLabel?: string;
  },
): Promise<ImportResult> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!rows?.length) return { added: 0 };
  if (rows.length > MAX_ROWS_PER_CALL) {
    return { error: `Too many rows in one request — send at most ${MAX_ROWS_PER_CALL}.` };
  }

  // Each call can create invitations and bookings, so it is abuse-prone in
  // the same way bulk invite is. Same budget: enough for a few thousand
  // rows an hour, not enough to fill the table.
  const rl = await enforceRateLimit({ action: "sourcing_import", actorId, limit: 60, windowSec: 60 * 60 });
  if (!rl.allowed) {
    return { error: "Import rate limit reached. Please wait a bit and retry the remaining rows." };
  }

  const admin = createAdminClient();
  const failed: ImportResult["failed"] = [];

  // Normalise and drop anything without a handle before we spend a query.
  const clean = rows
    .map((r) => ({ ...r, handle: String(r.handle || "").trim().toLowerCase().replace(/^@/, "") }))
    .filter((r) => r.handle);
  if (!clean.length) return { added: 0 };

  // Re-resolve server-side. The preview's answer is a courtesy to the
  // admin, not an input to this.
  const { error: resolveErr, resolved } = await resolveHandles(
    admin,
    campaignId,
    clean.map((r) => r.handle),
  );
  if (resolveErr || !resolved) return { error: resolveErr || "Could not check the creator database." };

  // For "update" we need more than resolveHandles returns — it answers
  // "is this creator already on the list", not "which row are they and did
  // we write it". One extra equality-filtered read rather than widening
  // resolveHandles, which four other callers share.
  const existingByHandle = new Map<string, { id: string; notes: string | null; stage: string }>();
  if (opts.onExisting === "update") {
    const { data: existing, error: exErr } = await admin
      .from("campaign_bookings")
      .select("id, notes, stage, instagram_username")
      .eq("campaign_id", campaignId);
    if (exErr) return { error: "Could not read this campaign's existing bookings." };
    for (const b of existing || []) {
      const key = String(b.instagram_username || "").toLowerCase();
      if (key) existingByHandle.set(key, { id: b.id, notes: b.notes, stage: b.stage });
    }
  }

  let skippedSourced = 0;
  let skippedNew = 0;
  let skippedManual = 0;
  const toBook: { row: ImportRowInput; influencerId: string | null; invitationId: string | null }[] = [];
  const toUpdate: { row: ImportRowInput; id: string; fromStage: string }[] = [];
  const needInvitation: ImportRowInput[] = [];

  for (const row of clean) {
    const r = resolved.get(row.handle);
    if (!r || r.kind === "sourced") {
      const prior = existingByHandle.get(row.handle);
      // Ours to refresh, or somebody's hand-built row to leave alone. A
      // substring test on the marker key is enough and keeps this action
      // free of the backfill's own trailer format.
      if (opts.onExisting === "update" && prior && opts.updateGuardKey) {
        if (String(prior.notes || "").includes(opts.updateGuardKey)) {
          toUpdate.push({ row, id: prior.id, fromStage: prior.stage });
        } else {
          skippedManual++;
        }
      } else {
        skippedSourced++;
      }
      continue;
    }
    if (r.kind === "new") {
      if (!opts.createNew) {
        skippedNew++;
        continue;
      }
      needInvitation.push(row);
      continue;
    }
    toBook.push({ row, influencerId: r.influencerId, invitationId: r.invitationId });
  }

  // New creators enter the database first, in one insert. If this fails
  // nobody from this group gets a booking — a booking with no creator
  // record behind it is the spreadsheet problem all over again.
  let invitationsCreated = 0;
  if (needInvitation.length) {
    const invitationRows = needInvitation.map((row) => ({
      full_name: clampLen(row.name || "", NAME_MAX) || null,
      instagram_username: row.handle,
      // category_raw is the brand's wording and must NOT become a canonical
      // category — those drive campaign matching. It rides along as prose.
      notes: clampLen([row.notes, row.category ? `Category (as given): ${row.category}` : ""].filter(Boolean).join(" · "), NOTE_MAX) || null,
      created_by: actorId,
      status: "pending",
    }));

    const { data: created, error: invErr } = await admin
      .from("influencer_invitations")
      .insert(invitationRows)
      .select("id, instagram_username");

    if (invErr) {
      // One bad row must not lose the rest. Retry individually; a handle
      // that lost a race is re-read rather than failed.
      logError("sourcing.import.invitations", invErr, { campaignId, count: invitationRows.length });
      for (let i = 0; i < invitationRows.length; i++) {
        const { data: one, error: oneErr } = await admin
          .from("influencer_invitations")
          .insert(invitationRows[i])
          .select("id")
          .single();
        if (!oneErr && one) {
          invitationsCreated++;
          toBook.push({ row: needInvitation[i], influencerId: null, invitationId: one.id });
        } else {
          const { data: raced } = await admin
            .from("influencer_invitations")
            .select("id")
            .ilike("instagram_username", invitationRows[i].instagram_username)
            .limit(1);
          if (raced?.length) {
            toBook.push({ row: needInvitation[i], influencerId: null, invitationId: raced[0].id });
          } else {
            failed.push({ handle: invitationRows[i].instagram_username, reason: "Could not add them to the creator database" });
          }
        }
      }
    } else {
      invitationsCreated = created?.length ?? 0;
      const idByHandle = new Map((created || []).map((c) => [String(c.instagram_username).toLowerCase(), c.id]));
      for (const row of needInvitation) {
        toBook.push({ row, influencerId: null, invitationId: idByHandle.get(row.handle) ?? null });
      }
    }
  }

  if (!toBook.length && !toUpdate.length) {
    return { added: 0, skippedSourced, skippedNew, skippedManual, invitationsCreated, failed };
  }

  const mode = toFulfilmentMode(opts.fulfilmentMode);
  const stageSet = STAGE_SETS[opts.allowStages ?? "pipeline"];
  let droppedLinks = 0;

  // Every column either path writes from the sheet. Shared so an insert and
  // a re-run update cannot disagree about what the sheet means.
  const sheetFields = (row: ImportRowInput) => {
    // The live link is hand-typed in the sheet, so it is validated rather
    // than trusted. A bad one is dropped and counted — writing it would put
    // a dead link on the booking and on the brand's view of it.
    let liveUrl: string | null = null;
    if (row.liveUrl) {
      if (isHttpUrl(row.liveUrl)) liveUrl = clampLen(row.liveUrl, 600);
      else droppedLinks++;
    }
    const prose = clampLen(row.notes || "", NOTE_MAX);
    return {
      creator_name: clampLen(row.name || "", NAME_MAX) || null,
      email: clampLen(row.email || "", 200) || null,
      phone: clampLen(row.phone || "", 40) || null,
      shipping_address: clampLen(row.address || "", ADDRESS_MAX) || null,
      tier: clampLen(row.tier || "", 40) || null,
      category_raw: clampLen(row.category || "", 120) || null,
      followers_count:
        Number.isFinite(Number(row.followers)) && Number(row.followers) > 0 ? Number(row.followers) : null,
      quoted_fee_paise: toPaise(row.quotedFee),
      agreed_fee_paise: toPaise(row.agreedFee),
      product_cost_paise: toPaise(row.productCost),
      // The suffix is appended after clamping, so a marker always survives.
      notes: [prose, row.notesSuffix || ""].filter(Boolean).join("") || null,
      fulfilment_mode: toFulfilmentMode(row.fulfilmentMode ?? mode),
      stage: row.stage && stageSet.has(row.stage) ? row.stage : "shortlisted",
      live_url: liveUrl,
      live_at: row.liveAt || null,
      contacted_at: row.contactedAt || null,
      confirmed_at: row.confirmedAt || null,
      script_shared_at: row.scriptSharedAt || null,
      admin_revision_note: clampLen(row.revisionNote || "", 500) || null,
    };
  };

  const bookingRows = toBook.map(({ row, influencerId, invitationId }) => ({
    campaign_id: campaignId,
    influencer_id: influencerId,
    invitation_id: invitationId,
    instagram_username: row.handle,
    created_by: actorId,
    ...sheetFields(row),
  }));

  // NOT an upsert: the unique index is on (campaign_id, lower(handle)), an
  // EXPRESSION index, and PostgREST's on_conflict can only name plain
  // columns. The index still backstops the race the per-row retry handles.
  let added = 0;
  const bornAt: { booking_id: string; stage: string }[] = [];

  if (bookingRows.length) {
    const { data: inserted, error: bookErr } = await admin
      .from("campaign_bookings")
      .insert(bookingRows)
      .select("id, stage");
    if (!bookErr) {
      added = inserted?.length ?? 0;
      for (const b of inserted || []) bornAt.push({ booking_id: b.id, stage: String(b.stage) });
    } else {
      for (const bookingRow of bookingRows) {
        const { data: one, error: rowErr } = await admin
          .from("campaign_bookings")
          .insert(bookingRow)
          .select("id, stage")
          .single();
        if (!rowErr && one) {
          added++;
          bornAt.push({ booking_id: one.id, stage: String(one.stage) });
        } else if (String(rowErr?.code) === "23505") {
          // A concurrent admin got there first. Not a failure.
          skippedSourced++;
        } else {
          failed.push({
            handle: bookingRow.instagram_username,
            reason: friendlyDbError("sourcing.import.row", rowErr, "Could not add them", {
              handle: bookingRow.instagram_username,
            }),
          });
        }
      }
    }
  }

  // Re-run: refresh the rows this import wrote before.
  //
  // Deliberately NOT routed through advanceBookingStage. That function
  // enforces the stage ladder and queues money on entry — correct for an
  // admin clicking through a live campaign, wrong here, where the sheet is
  // authoritative about a finished one and the payouts already happened
  // offline. So the stage column is set directly and PAYOUT_ON_ENTER is
  // never consulted.
  let updated = 0;
  if (toUpdate.length) {
    const results = await Promise.all(
      toUpdate.map(({ row, id }) =>
        admin
          .from("campaign_bookings")
          .update({ ...sheetFields(row), updated_at: new Date().toISOString() })
          .eq("id", id)
          .then((res) => ({ res, row, id })),
      ),
    );
    for (const { res, row } of results) {
      if (res.error) {
        failed.push({
          handle: row.handle,
          reason: friendlyDbError("sourcing.import.update", res.error, "Could not refresh them", {
            handle: row.handle,
          }),
        });
      } else {
        updated++;
      }
    }
  }

  // A booking born at `live` with an empty timeline reads as fabricated, so
  // every imported row gets its provenance and its landing stage recorded.
  const label = opts.importLabel || "Imported from a sheet";
  const events: Parameters<typeof logBookingEvents>[1] = [];
  for (const b of bornAt) {
    events.push({ booking_id: b.booking_id, kind: "note", note: label, actor_id: actorId });
    if (b.stage !== "shortlisted") {
      events.push({
        booking_id: b.booking_id,
        kind: "stage_change",
        from_stage: null,
        to_stage: b.stage,
        note: "set by import",
        actor_id: actorId,
      });
    }
  }
  for (const { id, row, fromStage } of toUpdate) {
    const to = row.stage && stageSet.has(row.stage) ? row.stage : "shortlisted";
    if (to !== fromStage) {
      events.push({
        booking_id: id,
        kind: "stage_change",
        from_stage: fromStage,
        to_stage: to,
        note: "updated by import",
        actor_id: actorId,
      });
    }
  }
  await logBookingEvents(admin, events);

  if (invitationsCreated > 0 || updated > 0) {
    await auditLog(
      "sourcing_import",
      actorId,
      `${campaignId}: ${added} booked, ${updated} refreshed, ${invitationsCreated} new creators invited`,
    );
  }

  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  return { added, updated, skippedSourced, skippedNew, skippedManual, invitationsCreated, droppedLinks, failed };
}
