"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { adminGate } from "@/lib/require-super-admin";

// Flip a support callback between "open" and "done". Viewers are
// read-only, so writes go through the same adminGate used by the other
// operations pages (quote-requests, payouts).
export async function setCallbackStatus(
  id: string,
  status: "open" | "done",
): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  if (status !== "open" && status !== "done") {
    return { error: "Invalid status" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("support_callbacks")
    .update({ status })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/callbacks");
  return { ok: true };
}
