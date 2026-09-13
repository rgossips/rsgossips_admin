"use client";

import { useSyncExternalStore } from "react";
import { getOpsBadges } from "@/app/dashboard/ops-actions";

// The live "needs attention" counts that drive the sidebar badges, the mobile
// bottom-nav, and the mobile Operations hub. Single source of truth so those
// three surfaces never drift, and fails soft — a transient error leaves the
// previous counts in place.
//
// ONE shared poll for the whole tab. Each surface used to run its own 30s
// interval, so a dashboard page fired the six count queries (plus an auth +
// role lookup) three times every 30s. During a Supabase slowdown that tripled
// load is what turned into bursts of 504 "Gateway Timeout" in error_logs. Now
// every useOpsBadges() subscribes to the same store: one request per interval
// while at least one badge is mounted, none while the tab is hidden.
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

const POLL_MS = 30_000;

// ---- module-level store (one per browser tab) ----
let snapshot: OpsBadges = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function poll() {
  // Nobody is looking — skip; the visibility handler refreshes on return.
  if (inFlight || (typeof document !== "undefined" && document.hidden)) return;
  inFlight = true;
  try {
    const next = await getOpsBadges();
    if (next) {
      snapshot = next;
      listeners.forEach((notify) => notify());
    }
  } catch {
    // Non-fatal — keep the previous counts.
  } finally {
    inFlight = false;
  }
}

function onVisibilityChange() {
  if (!document.hidden) void poll();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void poll();
    timer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

export function useOpsBadges(): OpsBadges {
  // Server render (and the first client render) show zeros, then the store's
  // counts once the first poll lands.
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
