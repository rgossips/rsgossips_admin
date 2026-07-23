"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
// Inline SVGs — the admin repo doesn't ship lucide-react.
const WifiOffIcon = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h.01" /><path d="M8.5 16.4a5 5 0 0 1 7 0" /><path d="M5 12.9a10 10 0 0 1 5.2-2.7" /><path d="M19 12.9a10 10 0 0 0-2.2-1.7" /><path d="M2 8.8a15 15 0 0 1 5.7-3.3" /><path d="M22 8.8a15 15 0 0 0-11.3-3.7" /><line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);
const RefreshIcon = ({ size = 16, spinning = false }: { size?: number; spinning?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={spinning ? "animate-spin" : ""}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" />
  </svg>
);

// Full-screen "you're offline" takeover. Shows when the browser reports the
// connection is gone (offline event / navigator.onLine) and auto-dismisses
// only once the network is genuinely back — the 'online' event is verified
// with a real same-origin probe because browsers sometimes fire it while DNS
// is still dead. The Refresh button runs the same probe on demand.
export default function OfflineGate() {
  const t = useTranslations("OfflineGate");
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);

  const probe = useCallback(async () => {
    try {
      // Same-origin tiny asset, cache-busted — no CORS, no caching lies.
      const res = await fetch(`/favicon.ico?ping=${Date.now()}`, { cache: "no-store" });
      return res.ok || res.status === 404; // any HTTP response = network is up
    } catch {
      return false;
    }
  }, []);

  const tryReconnect = useCallback(async () => {
    setChecking(true);
    const up = await probe();
    setChecking(false);
    if (up) setOffline(false);
    return up;
  }, [probe]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) setOffline(true);
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      // Verify before dismissing — only continue when the network is real.
      tryReconnect();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [tryReconnect]);

  // While the takeover is up, keep probing quietly so the page resumes the
  // moment connectivity returns even if no 'online' event fires.
  useEffect(() => {
    if (!offline) return;
    const id = setInterval(() => {
      probe().then((up) => up && setOffline(false));
    }, 4000);
    return () => clearInterval(id);
  }, [offline, probe]);

  if (!offline) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center">
        {/* Graphic — broken-signal art */}
        <div className="relative w-32 h-32 mx-auto mb-8">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10" />
          <div className="absolute inset-4 rounded-full bg-gradient-to-br from-indigo-500/15 to-purple-500/15" />
          <div
            className="absolute inset-8 rounded-full flex items-center justify-center text-white shadow-lg shadow-indigo-100"
            style={{ background: "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)" }}
          >
            <WifiOffIcon size={30} />
          </div>
          <span className="absolute -top-1 -right-1 text-2xl animate-bounce">📡</span>
        </div>

        <h1 className="text-2xl font-black text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mt-3">{t("body")}</p>

        <button
          onClick={tryReconnect}
          disabled={checking}
          className="mt-8 inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl text-white text-sm font-black shadow-lg shadow-indigo-100 cursor-pointer active:scale-95 transition-transform disabled:opacity-70"
          style={{ background: "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)" }}
        >
          <RefreshIcon size={16} spinning={checking} />
          {checking ? t("checking") : t("refresh")}
        </button>

        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-4">{t("autoNote")}</p>
      </div>
    </div>
  );
}
