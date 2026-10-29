"use server";

import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";

// This page has only one write of its own.
//
// Everything else it does already has an owner: searchCreatorPool ranks the
// pool and importFromPool puts people on the tracker, both in
// ../sourcing/pool-actions.ts. A second copy of either would be a second
// chance for this page and the inline picker on the tracker to disagree
// about who matches a brief, or to write a booking two different ways.

/**
 * Record that a matching list left the building.
 *
 * The sheet carries names, handles, cities and emails — the same PII the
 * applicant and influencer exports are audit-logged for, so this is too.
 * `requireAdmin()` rather than a viewer gate for the same reason: the whole
 * creator base is behind it, filtered only by one campaign's brief.
 *
 * Called AFTER the file is in their hands and deliberately not awaited by
 * the caller: an audit write that fails must not cost them the download.
 */
export async function logMatchExport(
  count: number,
  campaignId: string,
  campaignTitle: string,
): Promise<{ error?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  await auditLog(
    "campaign_match_export",
    actorId,
    `${n} creators · ${String(campaignTitle || "").slice(0, 60)} (${String(campaignId).slice(0, 36)})`,
  );
  return {};
}
