"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

// The live "needs attention" counts that drive the sidebar badges, the mobile
// bottom-nav, and the mobile Operations hub. Single source of truth so those
// three surfaces never drift. Polls every 30s (same cadence the sidebar used)
// and fails soft — a transient error leaves the previous counts in place.
//
// Keys mirror the sidebar's badgeKey values so it can consume this directly:
//   pendingQuotes / openDisputes / pendingPayouts / referralReviews /
//   campaignsUnderReview
// plus submittedDeliverables (from the notification bell's second stream).
export type OpsBadges = {
  pendingQuotes: number;
  openDisputes: number;
  pendingPayouts: number;
  referralReviews: number;
  campaignsUnderReview: number;
  submittedDeliverables: number;
};

const EMPTY: OpsBadges = {
  pendingQuotes: 0,
  openDisputes: 0,
  pendingPayouts: 0,
  referralReviews: 0,
  campaignsUnderReview: 0,
  submittedDeliverables: 0,
};

export function useOpsBadges(intervalMs = 30_000): OpsBadges {
  const [badges, setBadges] = useState<OpsBadges>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const fetchBadges = async () => {
      try {
        const [quoteRes, disputeRes, payoutRes, reviewRes, campaignRes, deliverRes] = await Promise.all([
          supabase
            .from("service_orders")
            .select("*", { count: "exact", head: true })
            .in("status", ["pending_quote", "counter_offered"]),
          supabase
            .from("escrow_disputes_v")
            .select("*", { count: "exact", head: true })
            .eq("escrow_status", "disputed"),
          supabase
            .from("campaign_applications")
            .select("*", { count: "exact", head: true })
            .in("payout_status", ["scheduled", "pending_creator_info"]),
          supabase
            .from("referrals")
            .select("*", { count: "exact", head: true })
            .eq("status", "MANUAL_REVIEW"),
          // A brand published a campaign and it is parked in the review
          // queue — nothing reaches creators until an admin approves it, so
          // it is the queue with the most time pressure on it.
          supabase
            .from("campaigns")
            .select("*", { count: "exact", head: true })
            .eq("status", "under_review"),
          supabase
            .from("campaign_applications")
            .select("*", { count: "exact", head: true })
            .eq("status", "submitted"),
        ]);
        if (cancelled) return;
        setBadges({
          pendingQuotes: quoteRes.count ?? 0,
          openDisputes: disputeRes.count ?? 0,
          pendingPayouts: payoutRes.count ?? 0,
          referralReviews: reviewRes.count ?? 0,
          campaignsUnderReview: campaignRes.count ?? 0,
          submittedDeliverables: deliverRes.count ?? 0,
        });
      } catch {
        // Non-fatal — keep the previous counts.
      }
    };

    fetchBadges();
    const timer = setInterval(fetchBadges, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return badges;
}
