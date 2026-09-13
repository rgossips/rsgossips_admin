"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-super-admin";
import { auditLog } from "@/lib/rate-limit";
import { ERROR_RETENTION_DAYS } from "./constants";

// A page holds 50 rows; the cap only guards against a crafted call.
const MAX_IDS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mark error_logs rows addressed, or reopen them. Admin-gated like the page
// itself (server actions bypass the page's redirect). Needs RS_Gossips
// migration 068 — without the column the update fails and says so.
//
// Deliberately NOT funnelled through logError(): that writes to error_logs,
// and a failure to update error_logs should not append to error_logs.
export async function setErrorLogStatus(
  ids: string[],
  status: "open" | "addressed",
): Promise<{ error?: string; updated?: number }> {
  let userId: string;
  try {
    userId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  if (status !== "open" && status !== "addressed") return { error: "Invalid status" };
  const clean = [...new Set((ids || []).filter((id) => typeof id === "string" && UUID.test(id)))];
  if (clean.length === 0) return { error: "Select at least one error" };
  if (clean.length > MAX_IDS) return { error: `Select at most ${MAX_IDS} errors at a time` };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("error_logs")
    .update(
      status === "addressed"
        ? { status, addressed_at: new Date().toISOString(), addressed_by: userId }
        : { status, addressed_at: null, addressed_by: null },
    )
    .in("id", clean)
    .select("id");

  if (error) {
    console.error("[errors.set-status]", JSON.stringify({ message: error.message, code: error.code }));
    // 42703 = undefined column: the migration hasn't been applied.
    return {
      error: error.code === "42703" || /status/.test(error.message)
        ? "Status tracking isn't enabled yet — apply migration 068."
        : "Couldn't update the selected errors. Please try again.",
    };
  }

  revalidatePath("/dashboard/errors");
  return { updated: data?.length ?? 0 };
}

// Permanently delete error_logs rows older than ERROR_RETENTION_DAYS.
// Housekeeping, not a user-data deletion, so admin (not super-admin) — the
// same level that can read the page. Audit-logged with the row count.
export async function deleteOldErrorLogs(): Promise<{ error?: string; deleted?: number }> {
  let userId: string;
  try {
    userId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const cutoff = new Date(Date.now() - ERROR_RETENTION_DAYS * 86_400_000).toISOString();
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("error_logs")
    .delete({ count: "exact" })
    .lt("occurred_at", cutoff);

  if (error) {
    console.error("[errors.purge]", JSON.stringify({ message: error.message, code: error.code }));
    return { error: "Couldn't delete old errors. Please try again." };
  }

  await auditLog("error_logs_purge", userId, `${count ?? 0} rows older than ${cutoff}`);
  revalidatePath("/dashboard/errors");
  revalidatePath("/dashboard/errors/analytics");
  return { deleted: count ?? 0 };
}
