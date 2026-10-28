"use client";

import { useEffect, useState } from "react";
import { ButtonSpinner } from "@/components/spinner";
import { TIERS, tierRangeLabel, type Tier } from "@/lib/sourcing/tiers";
import { SCOUT_MODES, type ScoutMode } from "@/lib/scouting/sources";
import {
  addScoutedCreator,
  getScoutBalance,
  logScoutExport,
  searchCandidates,
  tierCandidates,
  type ScoutRow,
} from "./scout-actions";
import { SCOUT_EXPORT_COLUMNS } from "./scout-export-columns";
import { MAX_TIER_PER_RUN, TIER_CHUNK } from "./scout-constants";

const MODE_LABEL: Record<ScoutMode, string> = {
  hashtag: "Hashtag",
  keyword: "Keyword",
  similar: "Similar to",
  location: "Location",
};
const MODE_PLACEHOLDER: Record<ScoutMode, string> = {
  hashtag: "fashionbloggerindia",
  keyword: "food blogger mumbai",
  similar: "@acreatorwelike",
  location: "Mumbai",
};
const MODE_HINT: Record<ScoutMode, string> = {
  hashtag: "Creators posting under this tag. 1 request.",
  keyword: "Instagram's own account search. 1 request.",
  similar: "Instagram's suggested-similar accounts. 2 requests (handle → id, then suggestions).",
  location: "Creators who TAGGED this place — patchy by nature. 2 requests.",
};

const nf = new Intl.NumberFormat("en-IN");
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

const TIER_TONE: Record<Tier, string> = {
  Nano: "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300",
  Micro: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  Macro: "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300",
  Celebrity: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300",
};

const KNOWN_LABEL: Record<string, string> = {
  registered: "Already a creator",
  invited: "Already invited",
  new: "New to us",
};

// The outreach note, kept in the browser between searches.
//
// `<Creator Name>` is the token, written the way an admin would type it
// rather than a {{mustache}} — this box is meant to be edited by whoever is
// doing the outreach, not maintained like code. `<handle>` is offered too
// because plenty of Instagram accounts carry no display name at all.
const MESSAGE_TOKEN = "<Creator Name>";
const FIRST_NAME_TOKEN = "<First Name>";
const HANDLE_TOKEN = "<handle>";
const MESSAGE_STORAGE_KEY = "rg.scouting.outreachMessage";

const DEFAULT_MESSAGE = `Hi ${MESSAGE_TOKEN}!

We have a collaboration opportunity for you related to your niche.

Kindly let us know if you are interested!`;

/**
 * A display name fit to greet someone by.
 *
 * Instagram display names are decorated: emoji, flags, pipes, "| Fashion
 * blogger", stylised unicode. Strip that, then fall back to the handle when
 * nothing legible survives — "Hi riyagadhavi09!" beats "Hi !".
 */
function displayName(fullName: string | null, username: string): string {
  const raw = (fullName || "").trim();
  if (!raw) return username;
  const cleaned = raw
    // Everything after a separator is a job title, not a name.
    .split(/[|•·(–—]/)[0]
    // Emoji, flags and variation selectors.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // Must contain a real letter — Latin or Devanagari covers what we see.
  return /[A-Za-zऀ-ॿ]/.test(cleaned) ? cleaned : username;
}

/**
 * The first word of that, for a warmer greeting.
 *
 * NOT the default, and the measurement is why: searching "fashion blogger
 * india" returns mostly AGGREGATOR accounts — "Indian Fashion Bloggers",
 * "Fashion Bloggers India" — and a first-word greeting turns those into
 * "Hi Indian!" and "Hi Fashion!". Across 22 real results only a handful
 * were people. So <Creator Name> uses the whole cleaned name, which is
 * never embarrassing, and <First Name> is offered for when you can see the
 * row is a person.
 */
function firstName(fullName: string | null, username: string): string {
  const full = displayName(fullName, username);
  if (full === username) return username;
  const first = full.split(/\s+/)[0] || "";
  return /[A-Za-zऀ-ॿ]/.test(first) ? first : full;
}

function fillTemplate(template: string, fullName: string | null, username: string): string {
  return template
    .split(MESSAGE_TOKEN)
    .join(displayName(fullName, username))
    .split(FIRST_NAME_TOKEN)
    .join(firstName(fullName, username))
    .split(HANDLE_TOKEN)
    .join(`@${username}`);
}

type Filters = {
  tiers: Set<Tier>;
  hideKnown: boolean;
  verifiedOnly: boolean;
  hidePrivate: boolean;
  hasEmail: boolean;
  minFollowers: string;
  maxFollowers: string;
};

const EMPTY_FILTERS: Filters = {
  tiers: new Set<Tier>(),
  hideKnown: true,
  verifiedOnly: false,
  hidePrivate: false,
  hasEmail: false,
  minFollowers: "",
  maxFollowers: "",
};

// Module scope: a component defined inside a stateful parent gets a new
// identity every render, which remounts it and loses focus (see CLAUDE.md,
// "Client component pitfalls").
function Chip({ children, tone = "" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${tone || "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
      {children}
    </span>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-gray-700 dark:text-gray-300">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer" />
      {label}
    </label>
  );
}

export function ScoutPanel() {
  const [mode, setMode] = useState<ScoutMode>("hashtag");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ScoutRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [tiering, setTiering] = useState(false);
  const [tierProgress, setTierProgress] = useState({ done: 0, total: 0 });
  const [balance, setBalance] = useState<{ requests: number; amount: number; currency: string } | null>(null);
  const [spent, setSpent] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});
  // Read storage in the INITIALISER, not an effect. An effect that calls
  // setState trips react-hooks/set-state-in-effect (the rule CLAUDE.md
  // records biting the reject-campaign modal) and would also render the
  // default for one frame before swapping it. The server has no storage, so
  // it renders the default and the textarea carries suppressHydrationWarning.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_MESSAGE;
    try {
      return window.localStorage.getItem(MESSAGE_STORAGE_KEY) || DEFAULT_MESSAGE;
    } catch {
      return DEFAULT_MESSAGE;
    }
  });
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void getScoutBalance().then((r) => {
      if (r.balance) setBalance(r.balance);
      else if (r.error) setMsg(r.error);
    });
  }, []);

  const updateMessage = (next: string) => {
    setMessage(next);
    try {
      window.localStorage.setItem(MESSAGE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const toggleOne = (username: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });

  const downloadSelected = async () => {
    const rowsToExport = rows.filter((r) => selected.has(r.username));
    if (rowsToExport.length === 0) return;
    setDownloading(true);
    setMsg(null);
    try {
      const body = rowsToExport.map((r, i) => {
        const cell: Record<string, string | number | null> = {
          sno: i + 1,
          handle: `@${r.username}`,
          name: r.fullName || "",
          tier: r.tier || "",
          // A creator we never looked up has NO follower count. Blank, never
          // 0 — a zero in a spreadsheet is read as a real measurement, and
          // whoever sorts by this column would bury them as the smallest.
          followers: typeof r.followers === "number" ? r.followers : null,
          follows: typeof r.follows === "number" ? r.follows : null,
          posts: typeof r.posts === "number" ? r.posts : null,
          verified: r.isVerified === null ? "" : r.isVerified ? "Yes" : "No",
          private: r.isPrivate === null ? "" : r.isPrivate ? "Yes" : "No",
          email: r.email || "",
          website: r.externalUrl || "",
          category: r.businessCategory || "",
          bio: r.bio || "",
          known: KNOWN_LABEL[r.known] || r.known,
          source: note || `${MODE_LABEL[mode]}: ${query}`,
          profileUrl: `https://instagram.com/${r.username}`,
          dmUrl: `https://ig.me/m/${r.username}`,
          message: fillTemplate(message, r.fullName, r.username),
        };
        return SCOUT_EXPORT_COLUMNS.map((c) => cell[c.key] ?? "");
      });

      // Loaded on demand — the library is large and only needed on click.
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([SCOUT_EXPORT_COLUMNS.map((c) => c.header), ...body]);
      ws["!cols"] = SCOUT_EXPORT_COLUMNS.map((c) => ({ wch: c.width }));
      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: body.length, c: SCOUT_EXPORT_COLUMNS.length - 1 },
        }),
      };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scouted Creators");

      const slug = (note || query || mode).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").slice(0, 40);
      XLSX.writeFile(wb, `scouted_${slug || mode}_${new Date().toISOString().slice(0, 10)}.xlsx`);

      // Best-effort, after the file is in their hands — an audit write that
      // fails must not cost them the download.
      void logScoutExport(rowsToExport.length, note || `${mode}: ${query}`);
    } catch {
      setMsg("Could not build the spreadsheet.");
    } finally {
      setDownloading(false);
    }
  };

  const copyFor = async (r: ScoutRow) => {
    const text = fillTemplate(message, r.fullName, r.username);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(r.username);
      window.setTimeout(() => setCopied((c) => (c === r.username ? null : c)), 1600);
    } catch {
      // Clipboard needs a secure context and a user gesture; if the browser
      // refuses, say so rather than leaving a button that looks like it
      // worked.
      setMsg("Couldn't reach the clipboard. Copy the message manually.");
    }
  };

  const runSearch = async () => {
    setSearching(true);
    setMsg(null);
    setRows([]);
    setAdded({});
    // A selection belongs to the result set it was made in. Carrying it into
    // a new search would let a handle that happens to appear in both searches
    // arrive pre-ticked.
    setSelected(new Set());
    const res = await searchCandidates(mode, query);
    if (res.error) setMsg(res.error);
    else {
      setRows(res.rows || []);
      setNote(res.note || null);
      if (res.balance) setBalance(res.balance);
      if ((res.rows || []).length === 0) setMsg("Instagram returned nobody for that. Try a different tag or wording.");
    }
    setSpent((s) => s + (res.requestsSpent || 0));
    setSearching(false);
  };

  // The untiered candidates we'd spend on, newest-to-us first.
  const untiered = rows.filter((r) => !r.tiered && (!filters.hideKnown || r.known === "new"));
  const toTier = untiered.slice(0, MAX_TIER_PER_RUN);

  const runTiering = async () => {
    if (toTier.length === 0) return;
    setTiering(true);
    setMsg(null);
    setTierProgress({ done: 0, total: toTier.length });
    for (let i = 0; i < toTier.length; i += TIER_CHUNK) {
      const chunk = toTier.slice(i, i + TIER_CHUNK);
      const res = await tierCandidates(chunk.map((c) => ({ username: c.username, pk: c.pk })));
      if (res.error) {
        setMsg(res.error);
        break;
      }
      if (res.balance) setBalance(res.balance);
      setSpent((s) => s + chunk.length);
      setRows((prev) =>
        prev.map((r) => {
          const hit = (res.results || []).find((x) => x.username === r.username);
          if (!hit) return r;
          return {
            ...r,
            tiered: true,
            followers: hit.followers ?? null,
            follows: hit.follows ?? null,
            posts: hit.posts ?? null,
            bio: hit.bio ?? null,
            email: hit.email ?? null,
            externalUrl: hit.externalUrl ?? null,
            businessCategory: hit.businessCategory ?? null,
            isVerified: hit.isVerified ?? r.isVerified,
            isPrivate: hit.isPrivate ?? r.isPrivate,
            tier: hit.tier ?? null,
          };
        }),
      );
      setTierProgress({ done: Math.min(i + chunk.length, toTier.length), total: toTier.length });
    }
    setTiering(false);
  };

  const add = async (r: ScoutRow) => {
    setAdding(r.username);
    const res = await addScoutedCreator({
      username: r.username,
      fullName: r.fullName,
      followers: r.followers,
      follows: r.follows,
      posts: r.posts,
      bio: r.bio,
      email: r.email,
      externalUrl: r.externalUrl,
      businessCategory: r.businessCategory,
      isVerified: r.isVerified,
      isPrivate: r.isPrivate,
      profilePicUrl: r.profilePicUrl,
      sourceNote: note || mode,
    });
    if (res.error) setMsg(res.error);
    else setAdded((p) => ({ ...p, [r.username]: res.outcome || "created" }));
    setAdding(null);
  };

  // Filtering. A creator we have NOT tiered has unknown followers — they are
  // never hidden by a follower filter, because hiding someone for missing
  // data is a different claim than the filter makes.
  const min = filters.minFollowers ? Number(filters.minFollowers) : null;
  const max = filters.maxFollowers ? Number(filters.maxFollowers) : null;
  const visible = rows.filter((r) => {
    if (filters.hideKnown && r.known !== "new") return false;
    if (filters.verifiedOnly && r.isVerified !== true) return false;
    if (filters.hidePrivate && r.isPrivate === true) return false;
    if (filters.hasEmail && !r.email) return false;
    if (filters.tiers.size > 0 && (!r.tier || !filters.tiers.has(r.tier))) return false;
    if (r.followers != null) {
      if (min != null && r.followers < min) return false;
      if (max != null && r.followers > max) return false;
    }
    return true;
  });

  const grouped: { tier: Tier | "Untiered"; rows: ScoutRow[] }[] = [
    ...TIERS.map((t) => ({ tier: t as Tier | "Untiered", rows: visible.filter((r) => r.tier === t) })),
    { tier: "Untiered" as const, rows: visible.filter((r) => !r.tier) },
  ].filter((g) => g.rows.length > 0);

  // Selected rows that the current filters are hiding — surfaced in the bar
  // so "12 selected" over a list of 4 is never a mystery.
  const visibleNames = new Set(visible.map((r) => r.username));
  const hiddenSelected = [...selected].filter((u) => !visibleNames.has(u)).length;

  const toggleTier = (t: Tier) =>
    setFilters((f) => {
      const next = new Set(f.tiers);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return { ...f, tiers: next };
    });

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap gap-1.5">
          {SCOUT_MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                mode === m
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            {mode === "hashtag" && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">#</span>
            )}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !searching && query.trim()) void runSearch();
              }}
              placeholder={MODE_PLACEHOLDER[mode]}
              className={`h-10 w-full rounded-xl border border-gray-200 bg-white pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 ${
                mode === "hashtag" ? "pl-7" : "pl-3"
              }`}
            />
          </div>
          <button
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-[13px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
          >
            {searching && <ButtonSpinner />}
            {searching ? "Searching…" : "Search Instagram"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">{MODE_HINT[mode]}</p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-[11px] dark:border-gray-800">
          <span className="text-gray-500 dark:text-gray-400">
            {balance ? (
              <>
                HikerAPI balance: <strong>{nf.format(balance.requests)}</strong> requests ·{" "}
                {balance.currency} {balance.amount.toFixed(2)}
              </>
            ) : (
              "Balance unavailable"
            )}
          </span>
          {spent > 0 && <span className="text-gray-400">{spent} spent this session</span>}
        </div>
      </div>

      {msg && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {msg}
        </p>
      )}

      {rows.length > 0 && (
        <>
          {/* Tiering — the paid step, stated before it runs */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                  {rows.length} found{note ? ` · ${note}` : ""}
                </h2>
                {/* Why a second step exists at all. */}
                <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
                  Instagram&apos;s search does not return follower counts, so tiers and follower filters need one
                  paid lookup each. {rows.filter((r) => r.known !== "new").length > 0 && (
                    <>
                      {rows.filter((r) => r.known !== "new").length} of these are already in our database and are
                      skipped — we already hold their numbers.
                    </>
                  )}
                </p>
              </div>
              {toTier.length > 0 && (
                <button
                  onClick={() => void runTiering()}
                  disabled={tiering}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
                >
                  {tiering && <ButtonSpinner />}
                  {tiering
                    ? `Looking up ${tierProgress.done}/${tierProgress.total}…`
                    : `Get followers for ${toTier.length} (${toTier.length} requests)`}
                </button>
              )}
            </div>
            {untiered.length > MAX_TIER_PER_RUN && !tiering && (
              <p className="mt-2 text-[11px] text-gray-400">
                Capped at {MAX_TIER_PER_RUN} per run to protect the prepaid balance — run it again for the rest.
              </p>
            )}
          </div>

          {/* Filters */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tier</span>
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTier(t)}
                  title={tierRangeLabel(t)}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                    filters.tiers.has(t)
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  {t}
                </button>
              ))}
              <span className="ml-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />
              <Toggle on={filters.hideKnown} onChange={(v) => setFilters((f) => ({ ...f, hideKnown: v }))} label="New to us only" />
              <Toggle on={filters.verifiedOnly} onChange={(v) => setFilters((f) => ({ ...f, verifiedOnly: v }))} label="Verified" />
              <Toggle on={filters.hidePrivate} onChange={(v) => setFilters((f) => ({ ...f, hidePrivate: v }))} label="Hide private" />
              <Toggle on={filters.hasEmail} onChange={(v) => setFilters((f) => ({ ...f, hasEmail: v }))} label="Has email" />
              <span className="ml-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Followers</span>
              <input
                value={filters.minFollowers}
                onChange={(e) => setFilters((f) => ({ ...f, minFollowers: e.target.value.replace(/\D/g, "") }))}
                placeholder="min"
                className="h-8 w-20 rounded-lg border border-gray-200 px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900"
              />
              <input
                value={filters.maxFollowers}
                onChange={(e) => setFilters((f) => ({ ...f, maxFollowers: e.target.value.replace(/\D/g, "") }))}
                placeholder="max"
                className="h-8 w-20 rounded-lg border border-gray-200 px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900"
              />
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="ml-auto text-[11px] font-semibold text-gray-500 hover:underline dark:text-gray-400"
              >
                Reset
              </button>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Showing {visible.length} of {rows.length}. A creator we haven&apos;t looked up yet has no follower
              count, so a follower filter never hides them.
            </p>
          </div>

          {/* Selection + download.
              "Select all" takes the VISIBLE rows, not every result — the
              filters above are how you choose who to export, and a button
              that quietly included people the filters had hidden would make
              the sheet disagree with the screen. */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-3 dark:border-gray-800 dark:bg-gray-900">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer"
                checked={visible.length > 0 && visible.every((r) => selected.has(r.username))}
                ref={(el) => {
                  if (el) {
                    const some = visible.some((r) => selected.has(r.username));
                    const all = visible.length > 0 && visible.every((r) => selected.has(r.username));
                    el.indeterminate = some && !all;
                  }
                }}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    for (const r of visible) {
                      if (e.target.checked) next.add(r.username);
                      else next.delete(r.username);
                    }
                    return next;
                  })
                }
              />
              Select all shown ({visible.length})
            </label>

            {/* Selection is deliberately STICKY across filter changes, so you
                can build a list over several passes. That means some of it
                can be off-screen — which must be said, or the sheet contains
                people the screen does not show. */}
            <span className="text-[12px] text-gray-500 dark:text-gray-400">
              {selected.size} selected
              {hiddenSelected > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}
                  · {hiddenSelected} hidden by filters, still exported
                </span>
              )}
            </span>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-[11px] font-semibold text-gray-500 hover:underline dark:text-gray-400"
              >
                Clear
              </button>
            )}

            <button
              onClick={() => void downloadSelected()}
              disabled={selected.size === 0 || downloading}
              className="ml-auto inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
            >
              {downloading ? (
                <ButtonSpinner />
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
              {downloading ? "Building…" : `Download Excel${selected.size ? ` (${selected.size})` : ""}`}
            </button>
          </div>

          {/* The message each row's Copy button fills in */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Outreach message</h2>
              <button
                onClick={() => updateMessage(DEFAULT_MESSAGE)}
                className="text-[11px] font-semibold text-gray-500 hover:underline dark:text-gray-400"
              >
                Reset to default
              </button>
            </div>
            <textarea
              value={message}
              onChange={(e) => updateMessage(e.target.value)}
              rows={5}
              spellCheck
              suppressHydrationWarning
              className="mt-2 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-[13px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
            />
            <p className="mt-2 text-[11px] text-gray-400">
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{MESSAGE_TOKEN}</code> →
              their display name, cleaned of emoji and titles ·{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{FIRST_NAME_TOKEN}</code> →
              just the first word ·{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{HANDLE_TOKEN}</code> →
              @their_handle. A creator with no display name is greeted by handle. Saved in this browser.
            </p>
            {visible[0] && (
              <p className="mt-2 whitespace-pre-line rounded-xl bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Preview · @{visible[0].username}
                </span>
                {fillTemplate(message, visible[0].fullName, visible[0].username)}
              </p>
            )}
          </div>

          {/* Results, grouped by tier */}
          {grouped.map((g) => (
            <div key={g.tier} className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{g.tier}</h3>
                {g.tier !== "Untiered" && (
                  <span className="text-[11px] text-gray-400">{tierRangeLabel(g.tier as Tier)}</span>
                )}
                <span className="ml-auto text-[11px] font-semibold text-gray-400">{g.rows.length}</span>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {g.rows.map((r) => (
                  <div
                    key={r.username}
                    className={`flex flex-wrap items-center gap-3 px-5 py-3 ${
                      selected.has(r.username) ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.username)}
                      onChange={() => toggleOne(r.username)}
                      aria-label={`Select @${r.username}`}
                      className="h-4 w-4 shrink-0 cursor-pointer"
                    />
                    {r.profilePicUrl ? (
                      // Instagram CDN URLs are signed and expire, so this is
                      // a preview only — nothing here is stored. The Add
                      // action re-hosts nothing either; "Update missing
                      // details" owns re-hosting, and storing a CDN link
                      // directly yields dead images weeks later.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.profilePicUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-500 dark:bg-gray-700">
                        {r.username[0]?.toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={`https://instagram.com/${r.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-[13px] font-semibold text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                        >
                          @{r.username}
                        </a>
                        {r.isVerified && <Chip tone="bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">verified</Chip>}
                        {r.isPrivate && <Chip>private</Chip>}
                        {r.tier && <Chip tone={TIER_TONE[r.tier]}>{r.tier}</Chip>}
                        {r.known !== "new" && (
                          <Chip tone="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            {KNOWN_LABEL[r.known]}
                          </Chip>
                        )}
                      </div>
                      <p className="truncate text-[12px] text-gray-500 dark:text-gray-400">
                        {r.fullName || "—"}
                        {r.businessCategory ? ` · ${r.businessCategory}` : ""}
                        {r.email ? ` · ${r.email}` : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-4 text-[12px] text-gray-600 dark:text-gray-300">
                      {r.followers != null ? (
                        <span title={`${nf.format(r.followers)} followers`}>
                          <strong>{compact(r.followers)}</strong> followers
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">— followers</span>
                      )}
                      {r.posts != null && <span className="hidden sm:inline">{compact(r.posts)} posts</span>}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* Copy sits BEFORE the DM link on purpose: the order
                          matches what you do — take the message, then open
                          the thread and paste it. */}
                      <button
                        onClick={() => void copyFor(r)}
                        title={fillTemplate(message, r.fullName, r.username)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                          copied === r.username
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                            : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                      >
                        {copied === r.username ? (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Copy
                          </>
                        )}
                      </button>
                      {/* ig.me opens the DM composer in the app or on web.
                          HikerAPI cannot send a DM and automating one would
                          risk the account — the message is written by a human. */}
                      <a
                        href={`https://ig.me/m/${r.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.2A7.9 7.9 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        DM
                      </a>
                      {added[r.username] ? (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {added[r.username] === "created" ? "Added" : added[r.username]}
                        </span>
                      ) : r.known === "new" ? (
                        <button
                          onClick={() => void add(r)}
                          disabled={adding === r.username}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          {adding === r.username ? <ButtonSpinner /> : "+"} Add
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
