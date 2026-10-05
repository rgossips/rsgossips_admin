"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog, enforceRateLimit } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { clampLen } from "@/lib/validation";
import { resolveHandles, type HandleKind } from "@/lib/sourcing/resolve-handles";
import { toFulfilmentMode, type FulfilmentMode } from "@/lib/sourcing/stages";
import { MAX_ROWS_PER_CALL } from "@/lib/sourcing/import-constants";

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
};

// Only the stages a sheet is allowed to assert. Anything past `confirmed`
// involves money or a deliverable and has to be walked in the portal, where
// each step is logged and the payout legs are queued by the transition.
const IMPORTABLE_STAGES = new Set(["shortlisted", "price_agreed", "confirmed", "declined"]);

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
  // Already on this campaign's list — not a failure, just nothing to do.
  skippedSourced?: number;
  // New creators the admin chose not to add to the database.
  skippedNew?: number;
  // Invitations created as a side effect of importing new creators.
  invitationsCreated?: number;
  failed?: { handle: string; reason: string }[];
};

export async function importSourcingRows(
  campaignId: string,
  rows: ImportRowInput[],
  opts: { createNew: boolean; fulfilmentMode?: FulfilmentMode },
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

  let skippedSourced = 0;
  let skippedNew = 0;
  const toBook: { row: ImportRowInput; influencerId: string | null; invitationId: string | null }[] = [];
  const needInvitation: ImportRowInput[] = [];

  for (const row of clean) {
    const r = resolved.get(row.handle);
    if (!r || r.kind === "sourced") {
      skippedSourced++;
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

  if (!toBook.length) {
    return { added: 0, skippedSourced, skippedNew, invitationsCreated, failed };
  }

  const mode = toFulfilmentMode(opts.fulfilmentMode);
  const bookingRows = toBook.map(({ row, influencerId, invitationId }) => ({
    campaign_id: campaignId,
    influencer_id: influencerId,
    invitation_id: invitationId,
    instagram_username: row.handle,
    creator_name: clampLen(row.name || "", NAME_MAX) || null,
    email: clampLen(row.email || "", 200) || null,
    phone: clampLen(row.phone || "", 40) || null,
    shipping_address: clampLen(row.address || "", ADDRESS_MAX) || null,
    tier: clampLen(row.tier || "", 40) || null,
    category_raw: clampLen(row.category || "", 120) || null,
    followers_count: Number.isFinite(Number(row.followers)) && Number(row.followers) > 0 ? Number(row.followers) : null,
    quoted_fee_paise: toPaise(row.quotedFee),
    agreed_fee_paise: toPaise(row.agreedFee),
    product_cost_paise: toPaise(row.productCost),
    notes: clampLen(row.notes || "", NOTE_MAX) || null,
    fulfilment_mode: mode,
    stage: row.stage && IMPORTABLE_STAGES.has(row.stage) ? row.stage : "shortlisted",
    created_by: actorId,
  }));

  // NOT an upsert: the unique index is on (campaign_id, lower(handle)), an
  // EXPRESSION index, and PostgREST's on_conflict can only name plain
  // columns. The index still backstops the race the per-row retry handles.
  let added = 0;
  const { data: inserted, error: bookErr } = await admin.from("campaign_bookings").insert(bookingRows).select("id");
  if (!bookErr) {
    added = inserted?.length ?? 0;
  } else {
    for (const bookingRow of bookingRows) {
      const { error: rowErr } = await admin.from("campaign_bookings").insert(bookingRow);
      if (!rowErr) {
        added++;
      } else if (String(rowErr.code) === "23505") {
        // A concurrent admin got there first. Not a failure.
        skippedSourced++;
      } else {
        failed.push({
          handle: bookingRow.instagram_username,
          reason: friendlyDbError("sourcing.import.row", rowErr, "Could not add them", { handle: bookingRow.instagram_username }),
        });
      }
    }
  }

  if (invitationsCreated > 0) {
    await auditLog("sourcing_import", actorId, `${campaignId}: ${added} booked, ${invitationsCreated} new creators invited`);
  }

  revalidatePath(`/dashboard/campaigns/${campaignId}/sourcing`);
  return { added, skippedSourced, skippedNew, invitationsCreated, failed };
}
