"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { viewerGate } from "@/lib/require-super-admin";
import { logError } from "@/lib/log";
import type { OpsBadges } from "@/hooks/use-ops-badges";

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

  const [quoteRes, disputeRes, payoutRes, reviewRes, campaignRes, deliverRes] = await Promise.all([
    admin.from("service_orders").select("*", { count: "exact", head: true }).in("status", ["pending_quote", "counter_offered"]),
    admin.from("escrow_disputes_v").select("*", { count: "exact", head: true }).eq("escrow_status", "disputed"),
    admin.from("campaign_applications").select("*", { count: "exact", head: true }).in("payout_status", ["scheduled", "pending_creator_info"]),
    admin.from("referrals").select("*", { count: "exact", head: true }).eq("status", "MANUAL_REVIEW"),
    // A brand published a campaign and it is parked in the review queue —
    // nothing reaches creators until an admin approves it.
    admin.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "under_review"),
    admin.from("campaign_applications").select("*", { count: "exact", head: true }).eq("status", "submitted"),
  ]);

  for (const [name, res] of Object.entries({ quoteRes, disputeRes, payoutRes, reviewRes, campaignRes, deliverRes })) {
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
  };
}

export type AwaitingActionFeed = {
  quotes: { id: string; order_number: string | null; service_title: string | null; status: string; created_at: string; updated_at: string | null }[];
  submissions: { id: string; campaign_id: string; created_at: string; updated_at: string | null; campaign_title: string | null }[];
  reviews: { campaign_id: string; title: string | null; created_at: string; brand_name: string | null }[];
};

// Raw rows for the notification bell; the client owns labels/translation.
export async function getAwaitingActionFeed(): Promise<AwaitingActionFeed | null> {
  if (await viewerGate()) return null;
  const admin = createAdminClient();

  const [quotesRes, appsRes, reviewRes] = await Promise.all([
    admin
      .from("service_orders")
      .select("id, order_number, service_title, status, created_at, updated_at")
      .in("status", ["pending_quote", "counter_offered", "revision_requested"])
      .order("updated_at", { ascending: false })
      .limit(10),
    admin
      .from("campaign_applications")
      .select("id, campaign_id, created_at, updated_at, campaigns(title)")
      .eq("status", "submitted")
      .order("updated_at", { ascending: false })
      .limit(10),
    // Invited-brand campaigns have no brand_profiles row, so fall back to the
    // invitation's name rather than showing a nameless entry.
    admin
      .from("campaigns")
      .select("campaign_id, title, created_at, brand_profiles(brand_name), brand_invitations(brand_name)")
      .eq("status", "under_review")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (quotesRes.error) logError("ops-feed", quotesRes.error, { query: "quotes" });
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
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
