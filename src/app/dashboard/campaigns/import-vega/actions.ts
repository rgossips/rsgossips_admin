"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin, isAdminOrAbove } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { resolveHandles } from "@/lib/sourcing/resolve-handles";
import { countSeats, type SeatCount } from "@/lib/sourcing/seats";
import { IMPORT_KEY, canAdvanceApplication, readImportMarker } from "@/lib/sourcing/import-vega";
import { importSourcingRows, type ImportResult } from "@/app/dashboard/campaigns/[id]/sourcing/import-actions";
import { BACKFILL_CHUNK_SIZE } from "@/lib/sourcing/import-constants";
import type { FulfilmentMode } from "@/lib/sourcing/stages";

// The historical Vega backfill, server side.
//
// Two actions: a read-only preview, and a chunked commit that delegates
// every write to importSourcingRows. There is deliberately no second write
// path — the only thing this file adds on top is reconciling the handful of
// applications that belong to creators who DO have accounts.
//
// Why applications are reconciled rather than created: campaign_applications
// .influencer_id is a FK to influencer_profiles, so 162 of the 176 creators
// in these sheets cannot have one at all. Inserting rows for the 14 who can
// would also assert a creator action they never took — they never applied,
// an admin put them on the campaign. So an application is only ever UPDATED
// where one already exists, and seats.ts already dedupes a creator who
// arrived by both routes, which means the booking alone counts them.

// What the browser sends. Mirrors ImportRowInput plus the application
// target, because the derivation happens during the parse where the sheet
// is still in hand.
export type VegaWireRow = {
  handle: string;
  sheet: string;
  line: number;
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
  notesSuffix?: string;
  stage: string;
  applicationStatus: string | null;
  liveUrl?: string;
  liveAt?: string | null;
  fulfilmentMode?: FulfilmentMode;
  revisionNote?: string;
  contactedAt?: string | null;
  confirmedAt?: string | null;
  scriptSharedAt?: string | null;
};

export type PreviewRow = { handle: string; stage: string; applicationStatus: string | null };

export type ApplicationChange = {
  handle: string;
  from: string;
  to: string;
  // False when the ladder guard refuses it — already there, or decided against.
  willChange: boolean;
};

export type VegaPreview = {
  error?: string;
  campaignTitle?: string;
  capacity?: number | null;
  counts?: { registered: number; invited: number; new: number; onCampaign: number };
  // Of the ones already on the campaign: ours to refresh vs hand-built.
  refreshable?: number;
  manual?: number;
  stageHistogram?: Record<string, number>;
  applicationChanges?: ApplicationChange[];
  seatsBefore?: SeatCount;
  seatsAfter?: SeatCount;
  existingApplications?: { total: number; byStatus: Record<string, number> };
};

export async function previewVegaImport(campaignId: string, rows: PreviewRow[]): Promise<VegaPreview> {
  if (!(await isAdminOrAbove())) return { error: "Forbidden" };
  if (!rows?.length) return { error: "Nothing to preview." };

  const admin = createAdminClient();

  const [{ data: campaign }, { error: resolveErr, resolved }, bookingsRes, appsRes] = await Promise.all([
    admin.from("campaigns").select("title, max_influencers").eq("campaign_id", campaignId).maybeSingle(),
    resolveHandles(admin, campaignId, rows.map((r) => r.handle)),
    admin.from("campaign_bookings").select("instagram_username, influencer_id, stage, notes").eq("campaign_id", campaignId),
    admin.from("campaign_applications").select("id, influencer_id, status").eq("campaign_id", campaignId),
  ]);

  if (resolveErr || !resolved) return { error: resolveErr || "Could not check the creator database." };
  if (bookingsRes.error || appsRes.error) return { error: "Could not read this campaign." };

  const bookings = bookingsRes.data || [];
  const applications = appsRes.data || [];

  const counts = { registered: 0, invited: 0, new: 0, onCampaign: 0 };
  let refreshable = 0;
  let manual = 0;
  const existingByHandle = new Map(
    bookings.map((b) => [String(b.instagram_username || "").toLowerCase(), b]),
  );

  for (const row of rows) {
    const r = resolved.get(row.handle);
    if (!r) continue;
    if (r.kind === "sourced") {
      counts.onCampaign++;
      const prior = existingByHandle.get(row.handle);
      if (readImportMarker(prior?.notes)?.import === IMPORT_KEY) refreshable++;
      else manual++;
    } else if (r.kind === "registered") counts.registered++;
    else if (r.kind === "invited") counts.invited++;
    else counts.new++;
  }

  const stageHistogram: Record<string, number> = {};
  for (const row of rows) stageHistogram[row.stage] = (stageHistogram[row.stage] || 0) + 1;

  // Which of the existing applications this import would move, and which
  // the forward-only guard refuses.
  const appByInfluencer = new Map(applications.filter((a) => a.influencer_id).map((a) => [a.influencer_id as string, a]));
  const applicationChanges: ApplicationChange[] = [];
  for (const row of rows) {
    if (!row.applicationStatus) continue;
    const r = resolved.get(row.handle);
    if (!r?.influencerId) continue;
    const app = appByInfluencer.get(r.influencerId);
    if (!app) continue;
    const from = String(app.status || "");
    applicationChanges.push({
      handle: row.handle,
      from,
      to: row.applicationStatus,
      willChange: canAdvanceApplication(from, row.applicationStatus),
    });
  }

  const byStatus: Record<string, number> = {};
  for (const a of applications) byStatus[String(a.status)] = (byStatus[String(a.status)] || 0) + 1;

  // Projected bookings: the sheet's rows at their target stages, replacing
  // any row for the same handle that is already there.
  const projected = new Map(
    bookings.map((b) => [
      String(b.instagram_username || "").toLowerCase(),
      { influencer_id: b.influencer_id, instagram_username: b.instagram_username, stage: b.stage },
    ]),
  );
  for (const row of rows) {
    const r = resolved.get(row.handle);
    projected.set(row.handle, {
      influencer_id: r?.influencerId ?? null,
      instagram_username: row.handle,
      stage: row.stage,
    });
  }

  // Applications as they WOULD be, so the seat projection reflects the
  // status moves too — an application reaching `approved` takes a seat.
  const projectedApps = applications.map((a) => {
    const change = applicationChanges.find(
      (c) => c.willChange && resolved.get(c.handle)?.influencerId === a.influencer_id,
    );
    return { influencer_id: a.influencer_id, status: change ? change.to : a.status };
  });

  return {
    campaignTitle: campaign?.title ?? undefined,
    capacity: campaign?.max_influencers ?? null,
    counts,
    refreshable,
    manual,
    stageHistogram,
    applicationChanges,
    seatsBefore: countSeats(campaign?.max_influencers, applications, bookings),
    seatsAfter: countSeats(campaign?.max_influencers, projectedApps, [...projected.values()]),
    existingApplications: { total: applications.length, byStatus },
  };
}

// ── Recovering a row whose handle cell is wrong ───────────────────────────
//
// Two rows in these workbooks have a reel URL pasted over the profile link,
// so they parse to the handle "reel". The creator NAME is still there, and
// we usually already know that person — so look them up in our own data
// rather than paying an API to read the reel.
//
// Measured: this recovers @thecozyshot, who the payment workbook says was
// paid Rs 8,000. Without it that creator is simply absent from the campaign.
//
// It only ever SUGGESTS. An admin confirms each one, because matching a
// human name is fuzzy and picking the wrong account would pay the wrong
// person — the same reason resolveHandles never keys on the query term.
export type HandleSuggestion = {
  key: string;
  name: string;
  candidates: { handle: string; fullName: string; kind: "registered" | "invited" }[];
};

export async function suggestHandlesByName(
  wanted: { key: string; name: string }[],
): Promise<{ error?: string; suggestions?: HandleSuggestion[] }> {
  if (!(await isAdminOrAbove())) return { error: "Forbidden" };
  const list = (wanted || []).filter((w) => w.name?.trim()).slice(0, 20);
  if (!list.length) return { suggestions: [] };

  const admin = createAdminClient();
  const suggestions: HandleSuggestion[] = [];

  for (const w of list) {
    // Parameterised .ilike rather than a hand-built .or() string: the value
    // is a name out of a spreadsheet, and commas or parens in an .or()
    // inject extra predicates against the RLS-bypassing client.
    const term = `%${w.name.trim()}%`;
    const [{ data: profiles }, { data: invites }] = await Promise.all([
      admin
        .from("influencer_profiles")
        .select("instagram_handle, full_name")
        .ilike("full_name", term)
        .limit(5),
      admin
        .from("influencer_invitations")
        .select("instagram_username, full_name")
        .ilike("full_name", term)
        .limit(5),
    ]);

    const candidates = [
      ...(profiles || [])
        .filter((p) => p.instagram_handle)
        .map((p) => ({
          handle: String(p.instagram_handle).toLowerCase(),
          fullName: String(p.full_name || ""),
          kind: "registered" as const,
        })),
      ...(invites || [])
        .filter((i) => i.instagram_username)
        .map((i) => ({
          handle: String(i.instagram_username).toLowerCase(),
          fullName: String(i.full_name || ""),
          kind: "invited" as const,
        })),
    ];

    // Dedupe by handle, preferring the registered record.
    const byHandle = new Map<string, (typeof candidates)[number]>();
    for (const c of candidates) if (!byHandle.has(c.handle)) byHandle.set(c.handle, c);

    suggestions.push({ key: w.key, name: w.name, candidates: [...byHandle.values()] });
  }

  return { suggestions };
}

// ── Capacity ─────────────────────────────────────────────────────────────
//
// VHSB-07 has 53 sheet rows against max_influencers = 50. seats.ts treats
// over-capacity as a warning and never a block, because people drop out —
// so the import proceeds either way and this is offered separately, never
// applied silently.
export async function raiseCampaignCapacity(
  campaignId: string,
  to: number,
): Promise<{ error?: string; capacity?: number }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!Number.isFinite(to) || to <= 0 || to > 10_000) return { error: "That capacity doesn't look right." };

  const admin = createAdminClient();
  const { data: before, error: readErr } = await admin
    .from("campaigns")
    .select("max_influencers")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (readErr) return { error: "Could not read the campaign." };

  const current = Number(before?.max_influencers ?? 0);
  // Only ever upward. Lowering a cap below the creators already booked is a
  // decision with consequences for the brand, not a side effect of an import.
  if (current >= to) return { capacity: current };

  const { error } = await admin.from("campaigns").update({ max_influencers: to }).eq("campaign_id", campaignId);
  if (error) return { error: "Could not update the campaign's capacity." };

  await auditLog("campaign_capacity_raise", actorId, `${campaignId}: ${current} -> ${to} (Vega backfill)`);
  return { capacity: to };
}

export type VegaCommitResult = ImportResult & {
  applicationsUpdated?: number;
  applicationsSkipped?: number;
};

export async function commitVegaChunk(campaignId: string, rows: VegaWireRow[]): Promise<VegaCommitResult> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
  if (!rows?.length) return { added: 0 };
  if (rows.length > BACKFILL_CHUNK_SIZE) {
    return { error: `Send at most ${BACKFILL_CHUNK_SIZE} rows per call.` };
  }

  // Every booking and invitation write goes through the shared action, with
  // the wider historical stage set and re-run updates switched on.
  const result = await importSourcingRows(
    campaignId,
    rows.map((r) => ({
      handle: r.handle,
      name: r.name,
      email: r.email,
      phone: r.phone,
      address: r.address,
      tier: r.tier,
      category: r.category,
      followers: r.followers,
      quotedFee: r.quotedFee,
      agreedFee: r.agreedFee,
      productCost: r.productCost,
      notes: r.notes,
      notesSuffix: r.notesSuffix,
      stage: r.stage,
      liveUrl: r.liveUrl,
      liveAt: r.liveAt,
      fulfilmentMode: r.fulfilmentMode,
      revisionNote: r.revisionNote,
      contactedAt: r.contactedAt,
      confirmedAt: r.confirmedAt,
      scriptSharedAt: r.scriptSharedAt,
    })),
    {
      createNew: true,
      allowStages: "historical",
      onExisting: "update",
      updateGuardKey: IMPORT_KEY,
      importLabel: `Imported from Vega × Adinfinity.xlsx · ${rows[0]?.sheet ?? "sheet"}`,
    },
  );
  if (result.error) return result;

  // ── Application reconciliation ─────────────────────────────────────────
  //
  // DELIBERATELY NOT updateApplicationStatus(). That action emails the
  // creator AND the brand and pushes a notification, which is right for a
  // live decision and wrong for recording a campaign that finished months
  // ago — it would notify 14 creators about work they already delivered.
  // A direct write fires nothing: there is no trigger on this table.
  let applicationsUpdated = 0;
  let applicationsSkipped = 0;

  const wanted = rows.filter((r) => r.applicationStatus);
  if (wanted.length) {
    const admin = createAdminClient();
    const { resolved } = await resolveHandles(admin, campaignId, wanted.map((r) => r.handle));
    const targetByInfluencer = new Map<string, string>();
    for (const r of wanted) {
      const id = resolved?.get(r.handle)?.influencerId;
      if (id && r.applicationStatus) targetByInfluencer.set(id, r.applicationStatus);
    }

    if (targetByInfluencer.size) {
      const { data: apps, error: appErr } = await admin
        .from("campaign_applications")
        .select("id, influencer_id, status")
        .eq("campaign_id", campaignId)
        .in("influencer_id", [...targetByInfluencer.keys()]);

      if (appErr) {
        logError("vega.reconcile.read", appErr, { campaignId });
      } else {
        const moves = (apps || []).flatMap((a) => {
          const to = targetByInfluencer.get(String(a.influencer_id));
          const from = String(a.status || "");
          if (!to) return [];
          if (!canAdvanceApplication(from, to)) {
            applicationsSkipped++;
            return [];
          }
          return [{ id: a.id as string, to }];
        });

        const results = await Promise.all(
          moves.map((m) =>
            admin
              .from("campaign_applications")
              .update({ status: m.to, updated_at: new Date().toISOString() })
              .eq("id", m.id),
          ),
        );
        for (const res of results) {
          if (res.error) {
            applicationsSkipped++;
            logError("vega.reconcile.write", res.error, { campaignId });
          } else {
            applicationsUpdated++;
          }
        }
      }
    }
  }

  await auditLog(
    "vega_backfill_import",
    actorId,
    `${campaignId}: +${result.added ?? 0} booked, ${result.updated ?? 0} refreshed, ` +
      `${result.invitationsCreated ?? 0} invited, ${applicationsUpdated} applications moved`,
  );

  return { ...result, applicationsUpdated, applicationsSkipped };
}
