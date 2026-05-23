"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls server data by re-running the current route's RSC fetch.
 * Used on list pages where DB changes from other users (or webhooks)
 * should appear without a full reload.
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const t = setInterval(() => {
      // Only refresh when the tab is visible to avoid wasted work
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);

  return null;
}
