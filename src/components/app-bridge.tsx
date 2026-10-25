"use client";

import { useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

/**
 * The portal's half of the native shell's bridge.
 *
 * The admin app (D:\Development\React Native\rsgossips_admin_app) is a
 * WebView around this site. It needs the signed-in admin's access token to
 * call the `register-push` edge function, so that an FCM token is filed
 * against the right person — otherwise ops pushes would go to whichever
 * admin last used the handset.
 *
 * WHY THE PAGE HAS TO HAND IT OVER. Authentication here is @supabase/ssr,
 * which keeps the session in HTTP-only cookies. That is the right choice
 * and it means the native layer cannot read the session itself, by design.
 * The shell's injected script therefore looks for `__rgGetAccessToken`,
 * which this component installs, and falls back to scraping localStorage
 * only because an older build might not have this yet.
 *
 * Renders nothing, and does nothing at all in a normal browser: the shell
 * sets `window.isRGossipsAdminApp` before this runs, and without it the
 * effect returns immediately. No token is exposed to a page that is not
 * inside the app.
 */
export function AppBridge() {
  useEffect(() => {
    const w = window as unknown as {
      isRGossipsAdminApp?: boolean;
      __rgGetAccessToken?: () => Promise<string | null>;
      ReactNativeWebView?: { postMessage: (s: string) => void };
    };
    if (!w.isRGossipsAdminApp) return;

    const supabase = createClient();

    // The shell calls this on every navigation. Reading the session each
    // time rather than caching one means a refreshed token is the one that
    // gets registered, and a signed-out tab hands over nothing.
    w.__rgGetAccessToken = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      } catch {
        return null;
      }
    };

    // Tell the shell immediately too, so the very first load registers
    // without waiting for the next navigation.
    void w.__rgGetAccessToken().then((token) => {
      if (token) w.ReactNativeWebView?.postMessage(JSON.stringify({ type: "token", token }));
    });

    // Signing out must drop this device's FCM token, or ops alerts keep
    // arriving for an admin who has left.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        w.ReactNativeWebView?.postMessage(JSON.stringify({ type: "signout" }));
      } else if (session?.access_token) {
        w.ReactNativeWebView?.postMessage(
          JSON.stringify({ type: "token", token: session.access_token }),
        );
      }
    });

    return () => {
      sub.subscription.unsubscribe();
      delete w.__rgGetAccessToken;
    };
  }, []);

  return null;
}
