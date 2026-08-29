"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

// Moderation actions for content_reports.
//
// Google Play's User Generated Content policy and Apple Guideline 1.2 both
// require that reports are ACTED ON, not merely collected. The app has had a
// report button since the safety release; until this queue existed the rows
// simply accumulated with nobody able to resolve them, which is the state both
// stores specifically ask about.

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Any admin may moderate. Deliberately not super-admin-only: a queue that
  // only one person can clear is a queue that does not get cleared, and both
  // stores care about response time.
  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();
  if (!profile) throw new Error("Not an admin");

  return profile;
}

type Resolution = "actioned" | "dismissed";

/**
 * Close a report. `resolution` records what the moderator decided; `note` is
 * free text kept for the audit trail — useful when the same user is reported
 * repeatedly and a pattern only shows across several reports.
 */
export async function resolveReport(
  reportId: string,
  resolution: Resolution,
  note?: string,
) {
  const admin = await requireAdmin();
  const db = createAdminClient();

  const { error } = await db
    .from("content_reports")
    .update({
      status: resolution,
      resolution: note?.trim() || null,
      resolved_by: admin.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reportId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/reports");
}

/** Move a report into review so two moderators don't work the same one. */
export async function claimReport(reportId: string) {
  await requireAdmin();
  const db = createAdminClient();

  const { error } = await db
    .from("content_reports")
    .update({ status: "reviewing" })
    .eq("id", reportId)
    // Only from 'open' — a report someone already resolved must not be
    // dragged back into the queue by a stale button click.
    .eq("status", "open");

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/reports");
}

/**
 * Suspend the reported account. Uses the same soft-delete lifecycle the app's
 * own deletion flow uses — status 'pending_deletion' with deleted_at set —
 * so sign-in is blocked immediately (the OTP verifier already refuses both
 * roles in that state) and the 30-day admin-restore window applies.
 */
export async function suspendReportedUser(
  reportId: string,
  userId: string,
  reason: string,
) {
  const admin = await requireAdmin();
  const db = createAdminClient();
  const now = new Date().toISOString();

  // The reported party may be either role, and we are not told which.
  // Attempt both; exactly one will match a row.
  const [inf, brand] = await Promise.all([
    db
      .from("influencer_profiles")
      .update({ status: "pending_deletion", deleted_at: now, deletion_reason: `Moderation: ${reason}`, updated_at: now })
      .eq("influencer_id", userId)
      .select("influencer_id"),
    db
      .from("brand_profiles")
      .update({ status: "pending_deletion", deleted_at: now, deletion_reason: `Moderation: ${reason}`, updated_at: now })
      .eq("brand_id", userId)
      .select("brand_id"),
  ]);

  const hit = (inf.data?.length || 0) + (brand.data?.length || 0);
  if (!hit) throw new Error("No profile found for that user");

  // Revoke every session so the suspension takes effect now rather than
  // whenever their JWT happens to expire.
  await db.from("device_sessions").update({ is_active: false }).eq("user_id", userId);

  const { error } = await db
    .from("content_reports")
    .update({
      status: "actioned",
      resolution: `Account suspended: ${reason}`,
      resolved_by: admin.id,
      resolved_at: now,
    })
    .eq("id", reportId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/reports");
}
