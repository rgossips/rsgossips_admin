"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { requireAdmin, adminGate } from "@/lib/require-super-admin";

// Platform fees were removed — the user pays exactly the quoted amount.
// We still write `platform_fee_amount: 0` on the service_orders row so
// callers that read the column don't break.

function notifyUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  type: string,
  title: string,
  body: { text: string; link: string; orderId: string },
) {
  return admin.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body: JSON.stringify(body),
    is_read: false,
  });
}

// ── Send a quote ─────────────────────────────────────────────────────────
//
// Admin fills in the quoted amount + delivery date + validity period etc.
// The user pays exactly the quoted amount — no platform fee added on top.

export async function sendQuote(orderId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const quotedAmount = parseInt((formData.get("quoted_amount") as string) || "0", 10);
  if (!Number.isFinite(quotedAmount) || quotedAmount <= 0) {
    return { error: "Quoted amount must be greater than zero" };
  }

  const quotedDelivery = (formData.get("quoted_delivery_date") as string) || null;
  const turnaroundDays = parseInt((formData.get("quoted_turnaround_days") as string) || "0", 10) || null;
  const revisionsAllowed = parseInt((formData.get("revisions_allowed") as string) || "2", 10) || 2;
  const finalFormats = ((formData.get("final_formats") as string) || "").trim();
  const validityDays = parseInt((formData.get("quote_validity_days") as string) || "7", 10) || 7;
  const quoteMessage = ((formData.get("quote_message") as string) || "").trim();
  const advancePct = parseInt((formData.get("advance_pct") as string) || "50", 10) || 50;

  const validUntil = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  // No platform fee: the user pays exactly the quoted amount.
  const total = quotedAmount;

  const { data: order, error: oErr } = await admin
    .from("service_orders")
    .select("user_id, service_title, status")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr) return { error: oErr.message };
  if (!order) return { error: "Order not found" };
  if (!["pending_quote", "counter_offered"].includes(order.status)) {
    return { error: `Can't send a quote in status "${order.status}"` };
  }

  const updates = {
    status: "quoted",
    quoted_amount: quotedAmount,
    platform_fee_amount: 0,
    total_amount: total,
    quoted_delivery_date: quotedDelivery,
    quoted_turnaround_days: turnaroundDays,
    revisions_allowed: revisionsAllowed,
    final_formats: finalFormats || null,
    quote_message: quoteMessage || null,
    quote_valid_until: validUntil,
    advance_pct: advancePct,
    updated_at: new Date().toISOString(),
  };
  const { error: uErr } = await admin.from("service_orders").update(updates).eq("id", orderId);
  if (uErr) return { error: uErr.message };

  await admin.from("service_order_events").insert({
    order_id: orderId,
    type: "quote_received",
    label: `Quote sent: ₹${total.toLocaleString("en-IN")} (${advancePct}% advance)`,
    meta: { quoted_amount: quotedAmount, total, valid_until: validUntil },
  });

  if (quoteMessage) {
    await admin.from("service_order_messages").insert({
      order_id: orderId,
      sender_id: actingUserId,
      sender_role: "admin",
      body: quoteMessage,
    });
  }

  await notifyUser(admin, order.user_id, "service_quote_sent", "Your quote is ready", {
    text: `${order.service_title}: ₹${total.toLocaleString("en-IN")} (${advancePct}% advance to start)`,
    link: `/influencer/services/orders/${orderId}`,
    orderId,
  });

  revalidatePath("/dashboard/quote-requests");
  revalidatePath(`/dashboard/quote-requests/${orderId}`);
  return { ok: true };
}

// ── Accept the user's counter offer ──────────────────────────────────────
// Converts counter_amount into the new quoted_amount and flips status back
// to 'quoted' so the user can accept-and-pay. No platform fee is added.

export async function acceptCounterOffer(orderId: string): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const admin = createAdminClient();
  const { data: order, error: oErr } = await admin
    .from("service_orders")
    .select("id, user_id, service_title, counter_amount, status, advance_pct, quote_valid_until")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr) return { error: oErr.message };
  if (!order) return { error: "Order not found" };
  if (order.status !== "counter_offered") return { error: "No counter to accept" };
  if (!order.counter_amount || order.counter_amount <= 0) return { error: "Counter amount missing" };

  const total = order.counter_amount;

  // Extend validity by 7 days from acceptance.
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: uErr } = await admin
    .from("service_orders")
    .update({
      status: "quoted",
      quoted_amount: order.counter_amount,
      platform_fee_amount: 0,
      total_amount: total,
      quote_valid_until: validUntil,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (uErr) return { error: uErr.message };

  await admin.from("service_order_events").insert({
    order_id: orderId,
    type: "counter_accepted",
    label: `Counter offer accepted: ₹${total.toLocaleString("en-IN")}`,
    meta: { total },
  });

  await notifyUser(admin, order.user_id, "service_counter_accepted", "Your counter offer was accepted", {
    text: `${order.service_title}: ₹${total.toLocaleString("en-IN")} — ready to confirm & pay`,
    link: `/influencer/services/orders/${orderId}`,
    orderId,
  });

  revalidatePath(`/dashboard/quote-requests/${orderId}`);
  return { ok: true };
}

// ── Deliver a draft (Phase 4) ────────────────────────────────────────────
// Admin pastes a URL to the watermarked preview + optional editor note.
// Flips status to 'draft_ready', clears any prior revision_requested state,
// fires a notification to the user.

const URL_RE = /^https?:\/\/\S+\.\S+/i;

export async function deliverDraft(orderId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const url = ((formData.get("draft_url") as string) || "").trim();
  const note = ((formData.get("draft_note") as string) || "").trim();
  if (!url || !URL_RE.test(url)) {
    return { error: "Paste a valid URL to the watermarked draft (Drive / Vimeo / Frame.io / etc.)" };
  }

  const admin = createAdminClient();
  const { data: order, error: oErr } = await admin
    .from("service_orders")
    .select("id, user_id, status, service_title, revisions_used, revisions_allowed")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr) return { error: oErr.message };
  if (!order) return { error: "Order not found" };
  if (!["in_progress", "revision_requested", "paid_advance"].includes(order.status)) {
    return { error: `Can't deliver a draft in status "${order.status}"` };
  }

  const { error: uErr } = await admin
    .from("service_orders")
    .update({
      draft_url: url,
      draft_note: note || null,
      status: "draft_ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (uErr) return { error: uErr.message };

  const isResend = order.status === "revision_requested";
  await admin.from("service_order_events").insert({
    order_id: orderId,
    type: isResend ? "revision_delivered" : "draft_delivered",
    label: isResend ? "Revised draft delivered" : "Draft delivered for review",
    meta: { draft_url: url, revisions_used: order.revisions_used },
  });

  if (note) {
    await admin.from("service_order_messages").insert({
      order_id: orderId,
      sender_id: actingUserId,
      sender_role: "admin",
      body: note,
    });
  }

  await notifyUser(admin, order.user_id, "service_draft_ready", "Your draft is ready", {
    text: `${order.service_title}: review the draft and either approve or request a revision.`,
    link: `/influencer/services/orders/${orderId}`,
    orderId,
  });

  revalidatePath(`/dashboard/quote-requests/${orderId}`);
  return { ok: true };
}

// ── Deliver final files (Phase 5) ────────────────────────────────────────
// Admin pastes a JSON array of { name, size, url } files. We require at
// least one entry with a valid URL. On success the order flips to
// 'completed' and the user is notified.

export async function deliverFinalFiles(orderId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const raw = ((formData.get("final_files_json") as string) || "[]").trim();
  let files: any;
  try {
    files = JSON.parse(raw);
  } catch {
    return { error: "Final files must be valid JSON" };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { error: "Add at least one file" };
  }
  const cleaned: { name: string; size: string; url: string }[] = [];
  for (const f of files) {
    const name = (f?.name || "").toString().trim();
    const size = (f?.size || "").toString().trim();
    const url = (f?.url || "").toString().trim();
    if (!name) return { error: "Each file needs a name" };
    if (!URL_RE.test(url)) return { error: `Invalid URL for "${name}"` };
    cleaned.push({ name, size, url });
  }

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("service_orders")
    .select("id, user_id, status, service_title")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found" };
  if (!["paid_final", "draft_ready"].includes(order.status)) {
    return { error: `Final files can only be delivered after final payment (current: ${order.status})` };
  }

  const now = new Date().toISOString();
  const { error: uErr } = await admin
    .from("service_orders")
    .update({
      final_files: cleaned,
      status: "completed",
      completed_at: now,
      updated_at: now,
    })
    .eq("id", orderId);
  if (uErr) return { error: uErr.message };

  await admin.from("service_order_events").insert({
    order_id: orderId,
    type: "completed",
    label: `Order completed — ${cleaned.length} file${cleaned.length === 1 ? "" : "s"} delivered`,
    meta: { count: cleaned.length },
  });

  await notifyUser(admin, order.user_id, "service_completed", "Your files are ready", {
    text: `${order.service_title}: download your files and leave a quick review.`,
    link: `/influencer/services/orders/${orderId}`,
    orderId,
  });

  revalidatePath(`/dashboard/quote-requests/${orderId}`);
  return { ok: true };
}

// ── Decline the request ──────────────────────────────────────────────────

export async function declineOrder(orderId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  let actingUserId: string;
  try { actingUserId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const reason = ((formData.get("decline_reason") as string) || "").trim();

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("service_orders")
    .select("user_id, service_title, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found" };

  const { error } = await admin
    .from("service_orders")
    .update({
      status: "declined",
      quote_message: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) return { error: error.message };

  await admin.from("service_order_events").insert({
    order_id: orderId,
    type: "declined_by_admin",
    label: reason ? `Declined: ${reason.slice(0, 140)}` : "Declined by ops",
    meta: { reason },
  });

  if (reason) {
    await admin.from("service_order_messages").insert({
      order_id: orderId,
      sender_id: actingUserId,
      sender_role: "admin",
      body: reason,
    });
  }

  await notifyUser(admin, order.user_id, "service_request_declined", "Your request was declined", {
    text: `${order.service_title}: ${reason || "Ops declined this request."}`,
    link: `/influencer/services/orders/${orderId}`,
    orderId,
  });

  revalidatePath(`/dashboard/quote-requests/${orderId}`);
  return { ok: true };
}
