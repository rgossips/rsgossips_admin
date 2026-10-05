"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { viewerGate, getCurrentUser } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";
import type { OpsBadges } from "@/hooks/use-ops-badges";
import { applyStream } from "@/lib/ops-streams";

// Server-side reads for the live "needs attention" surfaces (sidebar badges,
// mobile nav/hub, notification bell).
//
// These used to query from the BROWSER session client, which is bound by the
// consumer app's RLS — and an admin's session is just an authenticated user
// there. `campaigns_authenticated_read_open` (RS_Gossips migration 035) only
// exposes status IN ('active','open'), so every under_review campaign was
// invisible and the approval badge/bell sat at 0 while a brand waited. Reading
// through the service-role client here (gated, like every other dashboard
// read) is what makes the counts real.

export async function getOpsBadges(): Promise<OpsBadges | null> {
  if (await viewerGate()) return null;
  const admin = createAdminClient();

  const [quoteRes, disputeRes, payoutRes, reviewRes, campaignRes, deliverRes, verifyRes, callbackRes] = await Promise.all([
    admin.from("service_orders").select("*", { count: "exact", head: true }).in("status", ["pending_quote", "counter_offered"]),
    admin.from("escrow_disputes_v").select("*", { count: "exact", head: true }).eq("escrow_status", "disputed"),
    admin.from("campaign_applications").select("*", { count: "exact", head: true }).in("payout_status", ["scheduled", "pending_creator_info"]),
    admin.from("referrals").select("*", { count: "exact", head: true }).eq("status", "MANUAL_REVIEW"),
    // A brand published a campaign and it is parked in the review queue —
    // nothing reaches creators until an admin approves it.
    admin.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "under_review"),
    admin.from("campaign_applications").select("*", { count: "exact", head: true }).eq("status", "submitted"),
    // A brand can't publish until verified (brand-campaigns refuses), and
    // create-profile files every new brand as "pending".
    admin.from("brand_profiles").select("brand_id", { count: "exact", head: true }).eq("verification_status", "pending"),
    // Somebody asked us to telephone them. Nothing else in this list has a
    // person waiting by a phone, which is why it also gets its own block on
    // the dashboard rather than only a badge.
    admin.from("support_callbacks").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  for (const [name, res] of Object.entries({ quoteRes, disputeRes, payoutRes, reviewRes, campaignRes, deliverRes, verifyRes, callbackRes })) {
    // head:true counts are HEAD requests — a failure has no body, so the
    // error's message is empty ('{"message":""}' in error_logs). The HTTP
    // status is the only clue (e.g. 503/504 = transient Supabase/gateway).
    if (res.error) logError("ops-badges", res.error, { query: name, httpStatus: res.status, httpStatusText: res.statusText });
  }

  return {
    pendingQuotes: quoteRes.count ?? 0,
    openDisputes: disputeRes.count ?? 0,
    pendingPayouts: payoutRes.count ?? 0,
    referralReviews: reviewRes.count ?? 0,
    campaignsUnderReview: campaignRes.count ?? 0,
    submittedDeliverables: deliverRes.count ?? 0,
    brandVerifications: verifyRes.count ?? 0,
    openCallbacks: callbackRes.count ?? 0,
  };
}

export type AwaitingActionFeed = {
  quotes: { id: string; order_number: string | null; service_title: string | null; status: string; created_at: string; updated_at: string | null }[];
  submissions: { id: string; campaign_id: string; created_at: string; updated_at: string | null; campaign_title: string | null }[];
  reviews: { campaign_id: string; title: string | null; created_at: string; brand_name: string | null }[];
  verifications: { brand_id: string; brand_name: string | null; created_at: string }[];
  payouts: { id: string; campaign_title: string | null; creator_name: string | null; amount_paise: number | null; release_at: string }[];
  // Barter product owed to a creator: shipped but never confirmed, or the
  // creator said it never came. "No address yet" is deliberately NOT here —
  // that is chased by email from the campaign page, not a bell item.
  deliveries: { id: string; campaign_id: string; campaign_title: string | null; creator_name: string | null; expected_at: string | null; received: boolean | null }[];
  // Requested a phone call. Top of the bell: a person is waiting on us to
  // ring them, which nothing else in this feed can say.
  callbacks: { id: string; name: string | null; topic: string | null; phone: string | null; role: string | null; created_at: string }[];
  // Status changes on campaigns WE created. An admin-made campaign belongs to
  // a brand_invitations row with no account behind it, so update-application-
  // status has nobody to notify and the admin standing in for that brand
  // learned nothing. This is that missing notification.
  // Item keys this admin has dismissed. Empty when migration 082 is not
  // applied yet, which simply means nothing is marked read.
  readKeys: string[];
  adminCampaignUpdates: {
    id: string;
    campaign_id: string;
    campaign_title: string | null;
    creator_name: string | null;
    from_status: string | null;
    to_status: string;
    created_at: string;
  }[];
};

// Module scope: reading the clock during render trips react-hooks/purity.
const nowIso = () => new Date().toISOString();

// Raw rows for the notification bell; the client owns labels/translation.
export async function getAwaitingActionFeed(): Promise<AwaitingActionFeed | null> {
  if (await viewerGate()) return null;
  const admin = createAdminClient();

  // One instant for the whole pass, shared with the widget's counts so the
  // two can never straddle a tick.
  const now = nowIso();
  // Each stream's FILTERS come from OPS_STREAMS (lib/ops-streams.ts) — the
  // bell adds the select it needs to render and its own order/limit. The
  // widget head-counts the same filters. Before this they were two separate
  // sets of queries, and the four streams added after the widget shipped
  // were missing from it entirely.
  const [quotesRes, appsRes, reviewRes, verifyRes, payoutRes, deliveryRes, callbackFeedRes, adminUpdatesRes, readsRes] = await Promise.all([
    applyStream("quotes", admin
      .from("service_orders")
      .select("id, order_number, service_title, status, created_at, updated_at"), now)
      .order("updated_at", { ascending: false })
      .limit(10),
    applyStream("deliverables", admin
      .from("campaign_applications")
      .select("id, campaign_id, created_at, updated_at, campaigns(title)"), now)
      .order("updated_at", { ascending: false })
      .limit(10),
    // Invited-brand campaigns have no brand_profiles row, so fall back to the
    // invitation's name rather than showing a nameless entry.
    applyStream("campaignReviews", admin
      .from("campaigns")
      .select("campaign_id, title, created_at, brand_profiles(brand_name), brand_invitations(brand_name)"), now)
      .order("created_at", { ascending: false })
      .limit(10),
    // Brands waiting on verification — they can't publish until an admin acts.
    applyStream("brandVerifications", admin
      .from("brand_profiles")
      .select("brand_id, brand_name, gstin_trade_name, created_at"), now)
      .order("created_at", { ascending: false })
      .limit(10),
    // Payouts are manual now (RazorpayX was removed): a scheduled payout whose
    // release time has passed is money an admin owes a creator today.
    applyStream("payoutsDue", admin
      .from("campaign_applications")
      .select("id, escrow_amount, payout_release_at, campaigns(title), influencer_profiles(full_name, instagram_handle)"), now)
      .order("payout_release_at", { ascending: true })
      .limit(10),
    // Barter deliveries that stalled: dispatched and overdue with no word, or
    // explicitly reported as not arrived. Filtered in SQL so the bell never
    // loads the settled ones.
    applyStream("barterDeliveries", admin
      .from("campaign_applications")
      .select("id, campaign_id, shipping_expected_at, product_received, campaigns(title), influencer_profiles(full_name, instagram_handle)"), now)
      .order("shipping_expected_at", { ascending: true })
      .limit(10),
    applyStream("callbacks", admin
      .from("support_callbacks")
      .select("id, topic, phone, user_role, created_at, user_id"), now)
      .order("created_at", { ascending: false })
      .limit(10),
    // Inner-joined down to the campaign so only admin-owned ones come back:
    // brand_id IS NULL means there is no registered brand, which is exactly
    // the case where nobody else gets told.
    //
    // application_status_history only ever carries 'influencer' and 'brand'
    // changes — the admin portal writes the status without a history row —
    // so there is no need to filter out an admin's own clicks.
    applyStream("adminCampaignUpdates", admin
      .from("application_status_history")
      .select(
        "id, created_at, from_status, to_status, application_id, campaign_applications!inner(campaign_id, influencer_profiles(full_name, instagram_handle), campaigns!inner(title, brand_id))",
      ), now)
      .order("created_at", { ascending: false })
      .limit(10),
    // Dismissed items for whoever is asking. A missing table (migration 082
    // not applied) degrades to "nothing is read" rather than breaking the
    // bell — same probe-and-fall-back shape the errors page uses.
    (async () => {
      const me = await getCurrentUser();
      if (!me?.id) return { data: [], error: null };
      return admin.from("admin_notification_reads").select("item_key").eq("actor_id", me.id).limit(500);
    })(),
  ]);
  if (payoutRes.error) logError("ops-feed", payoutRes.error, { query: "payouts" });
  if (deliveryRes.error) logError("ops-feed", deliveryRes.error, { query: "deliveries" });
  if (callbackFeedRes.error) logError("ops-feed", callbackFeedRes.error, { query: "callbacks" });
  if (adminUpdatesRes.error) logError("ops-feed", adminUpdatesRes.error, { query: "adminCampaignUpdates" });

  if (quotesRes.error) logError("ops-feed", quotesRes.error, { query: "quotes" });
  if (verifyRes.error) logError("ops-feed", verifyRes.error, { query: "verifications" });
  if (appsRes.error) logError("ops-feed", appsRes.error, { query: "submissions" });
  if (reviewRes.error) logError("ops-feed", reviewRes.error, { query: "reviews" });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    quotes: (quotesRes.data || []) as AwaitingActionFeed["quotes"],
    submissions: (appsRes.data || []).map((a: any) => ({
      id: a.id,
      campaign_id: a.campaign_id,
      created_at: a.created_at,
      updated_at: a.updated_at,
      campaign_title: a.campaigns?.title ?? null,
    })),
    reviews: (reviewRes.data || []).map((c: any) => ({
      campaign_id: c.campaign_id,
      title: c.title,
      created_at: c.created_at,
      brand_name: c.brand_profiles?.brand_name ?? c.brand_invitations?.brand_name ?? null,
    })),
    verifications: (verifyRes.data || []).map((b: any) => ({
      brand_id: b.brand_id,
      brand_name: (b.brand_name || b.gstin_trade_name || "").trim() || null,
      created_at: b.created_at,
    })),
    payouts: (payoutRes.data || []).map((p: any) => ({
      id: p.id,
      campaign_title: p.campaigns?.title ?? null,
      creator_name: p.influencer_profiles?.full_name || (p.influencer_profiles?.instagram_handle ? `@${p.influencer_profiles.instagram_handle}` : null),
      amount_paise: typeof p.escrow_amount === "number" ? p.escrow_amount : null,
      release_at: p.payout_release_at,
    })),
    deliveries: (deliveryRes.data || []).map((d: any) => ({
      id: d.id,
      campaign_id: d.campaign_id,
      campaign_title: d.campaigns?.title ?? null,
      creator_name: d.influencer_profiles?.full_name || (d.influencer_profiles?.instagram_handle ? `@${d.influencer_profiles.instagram_handle}` : null),
      expected_at: d.shipping_expected_at ?? null,
      received: typeof d.product_received === "boolean" ? d.product_received : null,
    })),
    callbacks: (callbackFeedRes.data || []).map((c: any) => ({
      id: c.id,
      // The requester's name needs a second lookup the bell does not justify;
      // the topic and number are what an admin acts on.
      name: null,
      topic: c.topic ?? null,
      phone: c.phone ?? null,
      role: c.user_role ?? null,
      created_at: c.created_at,
    })),
    readKeys: (readsRes.data || []).map((r: { item_key: string }) => r.item_key),
    adminCampaignUpdates: (adminUpdatesRes.data || []).map((h: any) => {
      const app = h.campaign_applications;
      const inf = app?.influencer_profiles;
      return {
        id: h.id,
        campaign_id: app?.campaign_id,
        campaign_title: app?.campaigns?.title ?? null,
        creator_name: inf?.full_name || (inf?.instagram_handle ? `@${inf.instagram_handle}` : null),
        from_status: h.from_status ?? null,
        to_status: h.to_status,
        created_at: h.created_at,
      };
    }),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// Dismiss bell items for the calling admin.
//
// Keys are the bell's own synthetic ids ("callback-<uuid>" and friends), so
// nothing here needs to know what kind of thing was dismissed. Capped
// because the only caller is "mark all read" over a feed that is itself
// capped at ten per stream.
export async function markNotificationsRead(
  keys: string[],
): Promise<{ error?: string; success?: boolean }> {
  if (await viewerGate()) return { error: "Forbidden" };
  const me = await getCurrentUser();
  if (!me?.id) return { error: "Not signed in." };

  const clean = [...new Set((keys || []).map((k) => String(k).trim()).filter(Boolean))].slice(0, 200);
  if (clean.length === 0) return { success: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from("admin_notification_reads")
    .upsert(
      clean.map((item_key) => ({ actor_id: me.id, item_key })),
      { onConflict: "actor_id,item_key", ignoreDuplicates: true },
    );
  if (error) {
    // Reading is a convenience; never fail the caller's click over it.
    logError("ops-feed.mark-read", error, { count: clean.length });
    return { error: "Couldn't save that. Is migration 082 applied?" };
  }
  return { success: true };
}

// Bring an item back, for the inevitable mis-tap.
export async function markNotificationUnread(key: string): Promise<{ error?: string; success?: boolean }> {
  if (await viewerGate()) return { error: "Forbidden" };
  const me = await getCurrentUser();
  if (!me?.id) return { error: "Not signed in." };
  const admin = createAdminClient();
  const { error } = await admin.from("admin_notification_reads").delete().eq("actor_id", me.id).eq("item_key", key);
  if (error) {
    logError("ops-feed.mark-unread", error, { key });
    return { error: "Couldn't undo that." };
  }
  return { success: true };
}
