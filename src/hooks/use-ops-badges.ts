"use client";

import { useEffect, useState } from "react";
import { getOpsBadges } from "@/app/dashboard/ops-actions";

// The live "needs attention" counts that drive the sidebar badges, the mobile
// bottom-nav, and the mobile Operations hub. Single source of truth so those
// three surfaces never drift. Polls every 30s (same cadence the sidebar used)
// and fails soft — a transient error leaves the previous counts in place.
//
// Counts come from a server action on the service-role client. Do NOT move
// them back to the browser Supabase client: the consumer app's RLS hides
// non-active campaigns (and more) from an admin's session, so the counts read
// 0 — that is how the campaign-approval badge silently broke.
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

    const fetchBadges = async () => {
      try {
        const next = await getOpsBadges();
        if (cancelled || !next) return;
        setBadges(next);
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
