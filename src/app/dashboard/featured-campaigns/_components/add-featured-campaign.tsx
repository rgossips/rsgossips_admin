"use client";

import { useState, useTransition } from "react";
import { addFeaturedCampaign, searchCampaignsForFeature } from "../actions";

// Compact "Feature a campaign" button that opens a search dialog. The
// dialog calls into the server-side picker, hides already-featured
// campaigns, and inserts the row when the admin picks one.

export function AddFeaturedCampaignButton() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, startAdd] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onChange = async (q: string) => {
    setQuery(q);
    setError(null);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const rows = await searchCampaignsForFeature(q);
    setResults(rows);
    setSearching(false);
  };

  const onPick = (campaignId: string) => {
    startAdd(async () => {
      const res = await addFeaturedCampaign(campaignId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setQuery("");
      setResults([]);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Feature a campaign
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 w-[min(600px,95vw)] max-h-[85vh] flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Search campaigns</h3>
              <button
                onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
                className="text-[12px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="p-4 border-b border-gray-100 dark:border-gray-800">
              <input
                type="text"
                autoFocus
                placeholder="Search by campaign title or brand…"
                value={query}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-indigo-400"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {searching ? (
                <div className="text-center text-sm text-gray-400 py-8">Searching…</div>
              ) : results.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-8">
                  {query.trim().length < 2 ? "Type at least 2 characters." : "No matches (already-featured campaigns are hidden)."}
                </div>
              ) : (
                results.map((c: any) => (
                  <button
                    key={c.campaign_id}
                    type="button"
                    disabled={adding}
                    onClick={() => onPick(c.campaign_id)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-left cursor-pointer disabled:opacity-50"
                  >
                    {c.brandLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.brandLogo} alt={c.brandName} className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                        {(c.brandName || c.title || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{c.title || "(untitled campaign)"}</p>
                      <p className="text-[12px] text-gray-500 truncate">
                        {c.brandName || "Unknown brand"} · {c.status || "—"}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
            {error && (
              <p className="text-[12px] text-red-600 p-3 border-t border-red-100">{error}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
