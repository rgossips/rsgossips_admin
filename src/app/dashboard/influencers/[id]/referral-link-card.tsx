"use client";

import { useState } from "react";

// Shows the creator's Refer & Earn share link (mirrors the consumer app:
// influencer/refer builds https://rgossips.com/?ref=<referral_code>) with a
// one-click copy. The referral_code lives on influencer_profiles and is
// what the creator shares to earn reward credits.
export function ReferralLinkCard({ referralCode }: { referralCode: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const code = (referralCode || "").trim();
  const shareUrl = code ? `https://rgossips.com/?ref=${code}` : "";

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-pink-50 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Referral link</h2>
      </div>
      <div className="p-5 space-y-3">
        {code ? (
          <>
            <div>
              <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Code</p>
              <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white mt-0.5">{code}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Share link</p>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[12px] font-mono text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={copy}
                  className={`shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors ${
                    copied
                      ? "bg-emerald-600 text-white"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white"
                  }`}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-gray-400 dark:text-gray-500">
            No referral code yet — it's generated when the creator first opens the Refer &amp; Earn page.
          </p>
        )}
      </div>
    </div>
  );
}
