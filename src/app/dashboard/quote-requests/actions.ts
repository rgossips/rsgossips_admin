"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

// Pulls the platform-fee % from config; falls back to 15% if missing.
async function loadPlatformFeePct(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from("platform_config")
    .select("value")
    .eq("key", "service_platform_fee_pct")
    .maybeSingle();
  const n = Number((data as any)?.value);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

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
// We compute platform_fee_amount + total_amount server-side from the
// platform-fee % config so the math is consistent.

export async function sendQuote(orderId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

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
  const feePct = await loadPlatformFeePct(admin);
  const platformFee = Math.round(quotedAmount * (feePct / 100));
  const total = quotedAmount + platformFee;

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
    platform_fee_amount: platformFee,
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
    meta: { quoted_amount: quotedAmount, platform_fee: platformFee, total, valid_until: validUntil },
  });

  if (quoteMessage) {
    await admin.from("service_order_messages").insert({
      order_id: orderId,
      sender_id: user.id,
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
// Converts counter_amount into the new quoted_amount, recomputes fee + total,
// flips status back to 'quoted' so the user can accept-and-pay.

export async function acceptCounterOffer(orderId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

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

  const feePct = await loadPlatformFeePct(admin);
  const platformFee = Math.round(order.counter_amount * (feePct / 100));
  const total = order.counter_amount + platformFee;

  // Extend validity by 7 days from acceptance.
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: uErr } = await admin
    .from("service_orders")
    .update({
      status: "quoted",
      quoted_amount: order.counter_amount,
      platform_fee_amount: platformFee,
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

export async function deliverDraft(orderId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

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
      sender_id: user.id,
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

// ── Decline the request ──────────────────────────────────────────────────

export async function declineOrder(orderId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

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
      sender_id: user.id,
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
