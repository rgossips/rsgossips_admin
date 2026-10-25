// Turning the ops feed into pushes an admin's phone can receive.
//
// WHY THIS EXISTS. Admin notifications are DERIVED, not stored: the bell
// polls the source tables and recomputes what is awaiting action every 30
// seconds (lib/ops-streams.ts). That is right for a badge, which can arrive
// at the same answer forever, and exactly wrong for a push, which must fire
// once. A campaign sitting in review is in the feed on every single
// computation; pushing from the feed directly would buzz every phone about
// it every run until somebody approved it.
//
// So: admin_push_log (rgossips_web migration 089) records what has already
// gone out, its unique index does the deduping, and only rows the insert
// actually created become a notification. That is race-safe across
// overlapping runs in a way "select, then insert" is not.
//
// The notification itself is an ordinary `notifications` row, because
// notifications_push_after_insert (migration 056) already fans every insert
// out to web push AND FCM, and admins are auth users like anyone else. No
// second delivery path.
//
// ITEM KEYS MATCH THE BELL'S. The bell builds synthetic ids — `review-<id>`,
// `payout-<id>` — and stores them in admin_notification_reads when an admin
// clears one. Using the same strings here means the two ledgers describe the
// same things, and a tapped push can be marked read with the key it arrived
// with.

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUsers, type NotifyInput } from "@/lib/notify";
import { logError } from "@/lib/log";

/** One thing an admin should be told about, once. */
export type PushItem = {
  /** Matches the bell's Notification.id — see the note above. */
  key: string;
  title: string;
  text: string;
  /** Where tapping it should land, as a portal path. */
  link: string;
};

export type ProduceResult = {
  candidates: number;
  sent: number;
  admins: number;
  skippedAlreadySent: number;
  error?: string;
};

/**
 * Who gets paged.
 *
 * Admins and super-admins only. A `viewer` is read-only by definition —
 * waking someone at the weekend for work they are not permitted to do is
 * the clearest possible way to teach them to silence the app.
 */
const PAGED_ROLES = ["admin", "super_admin"];

/**
 * How many items one run may push, in total across all admins.
 *
 * A backlog should not arrive as fifty buzzes. If a run is capped the rest
 * stay unlogged and go out next time, oldest first — the cap delays, it
 * never drops. Deliberately small: the bell and the page are where a
 * backlog is *read*; push is only for "something new needs you".
 */
const MAX_ITEMS_PER_RUN = 10;

/** Gather the outstanding work, newest-relevant first. */
export async function collectPushItems(admin: SupabaseClient): Promise<PushItem[]> {
  const nowIso = new Date().toISOString();
  const items: PushItem[] = [];

  const [reviews, verifications, callbacks, payouts] = await Promise.all([
    admin.from("campaigns").select("campaign_id, title, created_at").eq("status", "under_review").limit(20),
    admin
      .from("brand_profiles")
      .select("brand_id, brand_name, created_at")
      .eq("verification_status", "pending")
      .limit(20),
    admin.from("support_callbacks").select("id, topic, phone, created_at").eq("status", "open").limit(20),
    // Both shapes of money owed. Mirrors the payoutsDue stream in
    // ops-streams.ts: escrow-release writes payout_status, while an admin
    // moving an application to `payment` on the campaign page writes
    // neither — and that second kind was invisible everywhere until
    // recently.
    admin
      .from("campaign_applications")
      .select("id, final_agreed_rate, escrow_amount, payout_release_at")
      .or(
        `and(payout_status.eq.scheduled,payout_release_at.lte.${nowIso}),and(status.eq.payment,payout_status.is.null)`,
      )
      .limit(20),
  ]);

  for (const c of reviews.data || []) {
    items.push({
      key: `review-${c.campaign_id}`,
      title: "Campaign waiting for review",
      text: c.title || "A campaign is waiting for approval.",
      link: `/dashboard/campaigns/${c.campaign_id}`,
    });
  }
  for (const b of verifications.data || []) {
    items.push({
      key: `verify-${b.brand_id}`,
      title: "Brand waiting for verification",
      text: b.brand_name || "A brand is waiting to be verified.",
      link: `/dashboard/brands/${b.brand_id}`,
    });
  }
  for (const c of callbacks.data || []) {
    items.push({
      key: `callback-${c.id}`,
      title: "Someone asked for a call back",
      text: c.topic ? `${c.topic} — ${c.phone || "no number"}` : "A support callback is open.",
      link: "/dashboard/callbacks",
    });
  }
  for (const p of payouts.data || []) {
    // escrow_amount is paise; final_agreed_rate is rupees. Getting this
    // backwards is a hundredfold error in what the push claims is owed.
    const rupees =
      typeof p.escrow_amount === "number"
        ? Math.round(p.escrow_amount / 100)
        : typeof p.final_agreed_rate === "number"
          ? p.final_agreed_rate
          : null;
    items.push({
      key: `payout-${p.id}`,
      title: "Payout due",
      text: rupees != null ? `₹${rupees.toLocaleString("en-IN")} is owed to a creator.` : "A creator is owed a payout.",
      link: "/dashboard/payouts",
    });
  }

  if (reviews.error) logError("admin-push.collect", reviews.error, { stream: "reviews" });
  if (verifications.error) logError("admin-push.collect", verifications.error, { stream: "verifications" });
  if (callbacks.error) logError("admin-push.collect", callbacks.error, { stream: "callbacks" });
  if (payouts.error) logError("admin-push.collect", payouts.error, { stream: "payouts" });

  return items;
}

/**
 * Run one pass: find outstanding work, tell each admin about whatever they
 * have not already been told, and record that we did.
 *
 * Returns counts rather than throwing, so the scheduled caller can log a
 * line and move on. A failure here must never retry blindly — a retry that
 * re-sent would be the exact failure the ledger exists to prevent, which is
 * why the ledger is written BEFORE the notification.
 */
export async function produceAdminPush(admin: SupabaseClient): Promise<ProduceResult> {
  const { data: adminRows, error: adminErr } = await admin
    .from("admin_profiles")
    .select("id, role")
    .in("role", PAGED_ROLES);
  if (adminErr) {
    logError("admin-push.admins", adminErr, {});
    return { candidates: 0, sent: 0, admins: 0, skippedAlreadySent: 0, error: "Could not read the admin list." };
  }
  const adminIds = (adminRows || []).map((a) => String(a.id)).filter(Boolean);
  if (adminIds.length === 0) return { candidates: 0, sent: 0, admins: 0, skippedAlreadySent: 0 };

  const items = await collectPushItems(admin);
  if (items.length === 0) {
    return { candidates: 0, sent: 0, admins: adminIds.length, skippedAlreadySent: 0 };
  }

  // Claim first. The unique index on (admin_id, item_key) means a row comes
  // back only when THIS run was the one that created it, so two overlapping
  // runs cannot both decide to send the same thing.
  const claims = adminIds.flatMap((adminId) =>
    items.map((it) => ({ admin_id: adminId, item_key: it.key })),
  );
  const { data: claimed, error: claimErr } = await admin
    .from("admin_push_log")
    .upsert(claims, { onConflict: "admin_id,item_key", ignoreDuplicates: true })
    .select("admin_id, item_key");
  if (claimErr) {
    logError("admin-push.claim", claimErr, { candidates: claims.length });
    return {
      candidates: claims.length,
      sent: 0,
      admins: adminIds.length,
      skippedAlreadySent: 0,
      error: "Could not record what was sent, so nothing was sent.",
    };
  }

  const fresh = claimed || [];
  const byKey = new Map(items.map((i) => [i.key, i]));

  // Cap AFTER claiming, and release what we are not sending — otherwise the
  // ledger would say those items had been delivered and they never would be.
  const toSend = fresh.slice(0, MAX_ITEMS_PER_RUN);
  const deferred = fresh.slice(MAX_ITEMS_PER_RUN);
  if (deferred.length > 0) {
    for (const d of deferred) {
      await admin
        .from("admin_push_log")
        .delete()
        .eq("admin_id", d.admin_id)
        .eq("item_key", d.item_key);
    }
  }

  const payloads: NotifyInput[] = [];
  for (const row of toSend) {
    const item = byKey.get(String(row.item_key));
    if (!item) continue;
    payloads.push({
      userId: String(row.admin_id),
      // A type the consumer apps have never seen degrades to a generic bell
      // icon there rather than breaking — see lib/notify.ts.
      type: "admin_ops",
      title: item.title,
      body: { text: item.text, link: item.link, key: item.key },
    });
  }

  if (payloads.length > 0) await notifyUsers(payloads, "admin-push");

  return {
    candidates: claims.length,
    sent: payloads.length,
    admins: adminIds.length,
    skippedAlreadySent: claims.length - fresh.length,
  };
}
