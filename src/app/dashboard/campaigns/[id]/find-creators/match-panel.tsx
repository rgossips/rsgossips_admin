"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { ButtonSpinner } from "@/components/spinner";
import { TIERS, tierForFollowers, tierRangeLabel, type Tier } from "@/lib/sourcing/tiers";
import { genderExcludes, genderLabel, type RequiredGender } from "@/lib/gender-target";
import {
  CAMPAIGN_TOKEN,
  DEFAULT_OUTREACH_MESSAGE,
  FIRST_NAME_TOKEN,
  HANDLE_TOKEN,
  MESSAGE_TOKEN,
  fillTemplate,
} from "@/lib/outreach-message";
import { INVITE_CHUNK_SIZE, MAX_INVITE_TOTAL, invitedAgo } from "@/lib/campaign-invite";
import type { PoolCandidate } from "@/lib/sourcing/pool";
import type { FulfilmentMode } from "@/lib/sourcing/stages";
import { importFromPool, searchCreatorPool } from "../sourcing/pool-actions";
import type { AssignableAdmin } from "../sourcing/outreach-actions";
import { MATCH_EXPORT_COLUMNS } from "./match-export-columns";
import { logMatchExport } from "./match-actions";
import { inviteCreatorsToCampaign } from "./invite-actions";

// Find creators in OUR OWN database who fit this campaign, then message them.
//
// The sibling page — Scout creators — answers the opposite question, finding
// people we do not have by spending HikerAPI credit. This one costs nothing
// and is the one to reach for first: measured today the pool is 603
// registered creators and 1,727 pending invitations, and an invited creator
// is a perfectly good person to DM, because they are in the database
// precisely because somebody already decided they were worth approaching.
//
// It shares that page's whole outreach apparatus deliberately — the same
// message tokens, the same Copy-then-DM order, the same selection-to-Excel
// flow — because it is the same job with a different starting point, and an
// admin should not have to learn two.

// How many ranked candidates to pull at a time. The full pool is scored
// SERVER-side; this is only how much of the ranking crosses the wire, and
// "Load more" raises it. A first paint of the whole base would be ~700KB
// for rows nobody scrolls to.
const PAGE_SIZE = 300;
const MAX_LOADED = 1500;
// importFromPool's own cap. Mirrored here only so the button can say so
// instead of being refused after the click.
const MAX_TRACK = 200;

const MESSAGE_STORAGE_KEY = "rg.campaignOutreach.message";

const nf = new Intl.NumberFormat("en-IN");
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

const TIER_TONE: Record<Tier, string> = {
  Nano: "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300",
  Micro: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  Macro: "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300",
  Celebrity: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300",
};

type SortKey = "match" | "followers" | "engagement";
const SORT_LABEL: Record<SortKey, string> = {
  match: "Best match",
  followers: "Most followers",
  engagement: "Highest engagement",
};

type Source = "all" | "registered" | "invited";
const SOURCE_LABEL: Record<Source, string> = {
  all: "Everyone",
  registered: "Onboarded only",
  invited: "Invited only",
};

// Have we told this creator about this campaign yet? The filter that makes
// a second pass safe: pick "Not told yet", select all shown, send.
type Told = "all" | "no" | "yes";
const TOLD_LABEL: Record<Told, string> = {
  all: "Told or not",
  no: "Not told yet",
  yes: "Already told",
};

type Filters = {
  tiers: Set<Tier>;
  source: Source;
  told: Told;
  gender: "" | RequiredGender;
  category: string;
  city: string;
  minFollowers: string;
  maxFollowers: string;
  minEngagement: string;
  hasEmail: boolean;
};

const EMPTY_FILTERS: Filters = {
  tiers: new Set<Tier>(),
  source: "all",
  told: "all",
  gender: "",
  category: "",
  city: "",
  minFollowers: "",
  maxFollowers: "",
  minEngagement: "",
  hasEmail: false,
};

// Module scope: a component defined inside a stateful parent gets a new
// identity on every render, which remounts it and loses focus — the cause of
// "the form resets as I type" recorded in CLAUDE.md.
function Chip({ children, tone = "" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
        tone || "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      {children}
    </span>
  );
}

function Num({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
      placeholder={placeholder}
      inputMode="decimal"
      className="h-8 w-20 rounded-lg border border-gray-200 px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    />
  );
}

export type MatchBrief = {
  categories: string[];
  cities: string[];
  followerMin: number | null;
  followerMax: number | null;
  /** Null unless the brief names exactly one gender — nine of 75 campaigns. */
  requiredGender: RequiredGender | null;
};

export function MatchPanel({
  campaignId,
  campaignTitle,
  brief,
  admins,
  currentAdminId,
  defaultMode,
  seatsFull,
  seatsNote,
  inviteBlocked,
}: {
  campaignId: string;
  campaignTitle: string;
  brief: MatchBrief;
  admins: AssignableAdmin[];
  currentAdminId: string;
  defaultMode: FulfilmentMode;
  seatsFull: boolean;
  seatsNote: string;
  /** Why creators can't be invited to this campaign, or null if they can. */
  inviteBlocked: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PoolCandidate[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [excluded, setExcluded] = useState(0);
  const [scanned, setScanned] = useState<{ profiles: number; invitations: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("match");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [assignTo, setAssignTo] = useState(currentAdminId);
  const [inviting, setInviting] = useState(false);
  const [inviteProgress, setInviteProgress] = useState<{ done: number; total: number } | null>(null);
  const [inviteNote, setInviteNote] = useState("");
  const [confirmInvite, setConfirmInvite] = useState(false);
  // Read storage in the INITIALISER, not an effect: setState in an effect
  // trips react-hooks/set-state-in-effect and would also render the default
  // for one frame before swapping it. The server has no storage, so it
  // renders the default and the textarea carries suppressHydrationWarning.
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_OUTREACH_MESSAGE;
    try {
      return window.localStorage.getItem(MESSAGE_STORAGE_KEY) || DEFAULT_OUTREACH_MESSAGE;
    } catch {
      return DEFAULT_OUTREACH_MESSAGE;
    }
  });

  const keyOf = (c: PoolCandidate) => c.influencerId || c.invitationId || c.handle;

  const load = async (opts?: { limit?: number; search?: string }) => {
    const want = opts?.limit ?? limit;
    const term = opts?.search ?? search;
    setLoading(true);
    setMsg(null);
    const res = await searchCreatorPool(campaignId, { search: term, limit: want });
    setLoading(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    setRows(res.candidates || []);
    setExcluded(res.excluded || 0);
    setScanned(res.scanned || null);
  };

  // One load on mount. The dependency list is empty on purpose: `load` reads
  // the current search and limit from state, and re-running it whenever
  // those change would fire a request per keystroke.
  useEffect(() => {
    void load({ limit: PAGE_SIZE, search: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = () => {
    setSelected(new Set());
    setLimit(PAGE_SIZE);
    void load({ limit: PAGE_SIZE });
  };

  const loadMore = () => {
    const next = Math.min(MAX_LOADED, limit + PAGE_SIZE);
    setLimit(next);
    void load({ limit: next });
  };

  const updateMessage = (next: string) => {
    setMessage(next);
    try {
      window.localStorage.setItem(MESSAGE_STORAGE_KEY, next);
    } catch {
      /* a browser with storage blocked still gets a working page */
    }
  };

  const messageFor = (c: PoolCandidate) =>
    fillTemplate(message, { fullName: c.name, username: c.handle, campaign: campaignTitle });

  const copyFor = async (c: PoolCandidate) => {
    const k = keyOf(c);
    try {
      await navigator.clipboard.writeText(messageFor(c));
      setCopied(k);
      window.setTimeout(() => setCopied((p) => (p === k ? null : p)), 1600);
    } catch {
      // The clipboard needs a secure context and a user gesture. If the
      // browser refuses, say so rather than leaving a button that looks
      // like it worked.
      setMsg("Couldn't reach the clipboard. Copy the message from the box above.");
    }
  };

  const toggleOne = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleTier = (t: Tier) =>
    setFilters((f) => {
      const next = new Set(f.tiers);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return { ...f, tiers: next };
    });

  // ---- Filtering -------------------------------------------------------
  //
  // Missing data is never a mismatch. A creator whose follower count or
  // engagement we do not hold is never hidden by a follower or engagement
  // filter — hiding somebody for missing data is a different claim than the
  // filter makes, and it is the rule the application match scorer and the
  // off-brief filter both follow.
  const min = filters.minFollowers ? Number(filters.minFollowers) : null;
  const max = filters.maxFollowers ? Number(filters.maxFollowers) : null;
  const minEr = filters.minEngagement ? Number(filters.minEngagement) : null;
  const city = filters.city.trim().toLowerCase();
  const category = filters.category.trim().toLowerCase();

  // Everything except the tier filter, so the tier chips can carry counts
  // that do not collapse the moment one is picked.
  const preTier = rows.filter((c) => {
    if (filters.source === "registered" && !c.registered) return false;
    if (filters.source === "invited" && c.registered) return false;
    if (filters.told === "no" && c.invitedAt) return false;
    if (filters.told === "yes" && !c.invitedAt) return false;
    if (filters.hasEmail && !c.email) return false;
    // Only a KNOWN opposite gender is excluded, which is the rule
    // genderExcludes owns and apply-campaign enforces. 54% of profiles
    // carry no gender; treating unknown as a miss would hide half the list.
    if (filters.gender && genderExcludes(filters.gender, c.gender)) return false;
    if (c.followers != null) {
      if (min != null && c.followers < min) return false;
      if (max != null && c.followers > max) return false;
    }
    if (c.engagementRate != null && minEr != null && c.engagementRate < minEr) return false;
    if (city) {
      const where = String(c.location || "").toLowerCase();
      if (!where || !(where.includes(city) || city.includes(where))) return false;
    }
    if (category && !c.categories.some((x) => x.toLowerCase().includes(category))) return false;
    return true;
  });

  const tierCounts = new Map<Tier | "unknown", number>();
  for (const c of preTier) {
    const t = tierForFollowers(c.followers) ?? "unknown";
    tierCounts.set(t, (tierCounts.get(t) || 0) + 1);
  }

  const visible = preTier.filter((c) => {
    if (filters.tiers.size === 0) return true;
    const t = tierForFollowers(c.followers);
    return !!t && filters.tiers.has(t);
  });

  const sorted = [...visible].sort((a, b) => {
    if (sort === "followers") return (b.followers ?? -1) - (a.followers ?? -1);
    if (sort === "engagement") return (b.engagementRate ?? -1) - (a.engagementRate ?? -1);
    if (b.score !== a.score) return b.score - a.score;
    return (b.followers || 0) - (a.followers || 0);
  });

  // Category options, from what actually came back, commonest first — a
  // fixed taxonomy list would offer dozens that match nobody here.
  const catCounts = new Map<string, number>();
  for (const c of rows) for (const x of c.categories) if (x) catCounts.set(x, (catCounts.get(x) || 0) + 1);
  const categoryOptions = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);

  const visibleKeys = new Set(sorted.map(keyOf));
  // Selection is deliberately STICKY across filter changes so a list can be
  // built over several passes. That means part of it can be off-screen,
  // which has to be said out loud or the sheet contains people the screen
  // does not show.
  const hiddenSelected = [...selected].filter((k) => !visibleKeys.has(k)).length;
  const allShownPicked = sorted.length > 0 && sorted.every((c) => selected.has(keyOf(c)));

  const chosen = rows.filter((c) => selected.has(keyOf(c)));

  const downloadSelected = async () => {
    if (chosen.length === 0) return;
    setDownloading(true);
    setMsg(null);
    try {
      const body = chosen.map((c, i) => {
        const cell: Record<string, string | number | null> = {
          sno: i + 1,
          handle: c.handle ? `@${c.handle}` : "",
          name: c.name,
          tier: tierForFollowers(c.followers) || "",
          // Blank, NEVER 0, for a creator we hold no number for: a zero in
          // a spreadsheet reads as a real measurement, and whoever sorts by
          // the column would bury them as the smallest account rather than
          // the unknown one.
          followers: c.followers ?? null,
          engagement: c.engagementRate ?? null,
          city: c.location || "",
          categories: c.categories.join(", "),
          gender: genderLabel(c.gender) || "",
          email: c.email || "",
          source: c.registered ? "Registered creator" : "Invited, not signed up",
          // Blank, never "No": an empty cell sorts and filters as "nothing
          // here", which is what it is, and a date is the useful answer.
          invited: c.invitedAt ? c.invitedAt.slice(0, 10) : "",
          match: c.score,
          why: c.reasons.join(" · "),
          campaign: campaignTitle,
          profileUrl: c.handle ? `https://instagram.com/${c.handle}` : "",
          dmUrl: c.handle ? `https://ig.me/m/${c.handle}` : "",
          message: messageFor(c),
        };
        return MATCH_EXPORT_COLUMNS.map((col) => cell[col.key] ?? "");
      });

      // Loaded on demand — the library is large and only needed on click.
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([MATCH_EXPORT_COLUMNS.map((c) => c.header), ...body]);
      ws["!cols"] = MATCH_EXPORT_COLUMNS.map((c) => ({ wch: c.width }));
      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: body.length, c: MATCH_EXPORT_COLUMNS.length - 1 },
        }),
      };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Matching Creators");
      const slug = (campaignTitle || "campaign").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").slice(0, 40);
      XLSX.writeFile(wb, `matching_creators_${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);

      // After the file is in their hands: an audit write that fails must not
      // cost them the download.
      void logMatchExport(chosen.length, campaignId, campaignTitle);
    } catch {
      setMsg("Could not build the spreadsheet.");
    } finally {
      setDownloading(false);
    }
  };

  const startTracking = async () => {
    if (chosen.length === 0) return;
    setTracking(true);
    setMsg(null);
    setNote(null);
    const res = await importFromPool(
      campaignId,
      chosen.map((c) => ({
        influencerId: c.influencerId,
        invitationId: c.invitationId,
        handle: c.handle,
        name: c.name,
        followers: c.followers,
      })),
      defaultMode,
      assignTo || null,
    );
    setTracking(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    const owner = admins.find((a) => a.id === assignTo);
    setNote(
      `Now tracking ${res.added}${res.skipped ? `, ${res.skipped} already on the list` : ""}` +
        `${owner ? `, assigned to ${owner.name}` : ""}.`,
    );
    setSelected(new Set());
    // They are on the campaign now, so the next read drops them.
    await load();
    router.refresh();
  };

  // What the current selection would actually reach, worked out BEFORE the
  // click. The two halves of the pool have different channels — a creator
  // with an account gets an in-app notification (which pushes to their
  // phone) while an invited-only creator can only be emailed — so "send
  // notifications" means different things per row, and the button should not
  // be the place that finds out.
  const reach = {
    appNotify: chosen.filter((c) => c.registered && !c.invitedAt).length,
    email: chosen.filter((c) => !c.invitedAt && c.email).length,
    noChannel: chosen.filter((c) => !c.invitedAt && !c.registered && !c.email).length,
    alreadyTold: chosen.filter((c) => c.invitedAt).length,
  };
  const toSend = chosen.filter((c) => !c.invitedAt && (c.registered || c.email));

  const sendInvites = async () => {
    if (toSend.length === 0) return;
    setInviting(true);
    setMsg(null);
    setNote(null);
    setConfirmInvite(false);

    // Chunked client-side, like bulk invite and the photo enrichment: every
    // email is a round trip to the send-email edge function, and a hundred
    // of them in one request does not finish inside a Netlify function.
    const chunks: (typeof toSend)[] = [];
    for (let i = 0; i < toSend.length; i += INVITE_CHUNK_SIZE) {
      chunks.push(toSend.slice(i, i + INVITE_CHUNK_SIZE));
    }
    const tally = { notified: 0, emailed: 0, alreadyInvited: 0, noChannel: 0, skipped: 0, emailFailed: 0 };
    let failure: string | null = null;
    let done = 0;
    setInviteProgress({ done: 0, total: toSend.length });

    for (const chunk of chunks) {
      const res = await inviteCreatorsToCampaign(
        campaignId,
        chunk.map((c) => ({ influencerId: c.influencerId, invitationId: c.invitationId })),
        inviteNote,
      );
      // A gate refusal (campaign closed, rate limit) applies to every
      // remaining chunk too, so stop rather than failing ten more times.
      if (res.error) {
        failure = res.error;
        break;
      }
      tally.notified += res.notified || 0;
      tally.emailed += res.emailed || 0;
      tally.alreadyInvited += res.alreadyInvited || 0;
      tally.noChannel += res.noChannel || 0;
      tally.skipped += res.skipped || 0;
      tally.emailFailed += res.emailFailed || 0;
      done += chunk.length;
      setInviteProgress({ done, total: toSend.length });
    }

    setInviting(false);
    setInviteProgress(null);
    if (failure) setMsg(failure);
    if (tally.notified || tally.emailed || tally.alreadyInvited) {
      setNote(
        [
          tally.notified ? `Notified ${tally.notified} in the app` : null,
          tally.emailed ? `emailed ${tally.emailed}` : null,
          tally.alreadyInvited ? `${tally.alreadyInvited} had already been told` : null,
          tally.noChannel ? `${tally.noChannel} have no email on file` : null,
          tally.emailFailed ? `${tally.emailFailed} email${tally.emailFailed === 1 ? "" : "s"} failed to send` : null,
          tally.skipped ? `${tally.skipped} skipped` : null,
        ]
          .filter(Boolean)
          .join(" · ")
          .replace(/^./, (ch) => ch.toUpperCase()),
      );
    }
    setSelected(new Set());
    // Re-read rather than patching the rows in place: the badge has to agree
    // with the database, and this is the one screen whose job is to stop a
    // creator being contacted twice.
    await load();
  };

  const briefChips = [
    brief.categories.length ? brief.categories.join(", ") : null,
    brief.cities.length ? brief.cities.join(", ") : null,
    brief.followerMin || brief.followerMax
      ? `${brief.followerMin ? compact(brief.followerMin) : "0"}–${brief.followerMax ? compact(brief.followerMax) : "∞"} followers`
      : null,
    brief.requiredGender ? `${genderLabel(brief.requiredGender)} only` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {/* What the ranking is ranking against, so the order is never a mystery */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Matched against this brief</h2>
            {briefChips.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {briefChips.map((c) => (
                  <Chip key={c} tone="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                    {c}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-gray-500">
                This campaign sets no targeting, so everyone scores alike — use the filters below to narrow it.
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[12px] text-gray-500 dark:text-gray-400">{seatsNote}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) runSearch();
            }}
            placeholder="Search the whole creator base by name or handle…"
            className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
          />
          <button
            onClick={runSearch}
            disabled={loading}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-gray-900 px-5 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
          >
            {loading && <ButtonSpinner />}
            {loading ? "Loading…" : "Search"}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          {scanned
            ? `Scored ${nf.format(scanned.profiles + scanned.invitations)} creators — ${nf.format(scanned.profiles)} registered and ${nf.format(scanned.invitations)} invited — and loaded the top ${nf.format(rows.length)}. `
            : ""}
          The filters below apply to what is loaded; the search box goes through the whole base.
          {excluded > 0 && ` ${excluded} match${excluded === 1 ? "" : "es"} left out — already on this campaign.`}
        </p>
      </div>

      {msg && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {msg}
        </p>
      )}
      {note && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {note}
        </p>
      )}

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
              {t} <span className="font-normal opacity-60">{tierCounts.get(t) || 0}</span>
            </button>
          ))}
          {(tierCounts.get("unknown") || 0) > 0 && (
            <span className="text-[11px] text-gray-400">
              + {tierCounts.get("unknown")} with no follower count on file
            </span>
          )}

          <span className="ml-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />

          <select
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value as Source }))}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>

          <select
            value={filters.told}
            onChange={(e) => setFilters((f) => ({ ...f, told: e.target.value as Told }))}
            title="Whether we have already invited them to THIS campaign"
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {(Object.keys(TOLD_LABEL) as Told[]).map((s) => (
              <option key={s} value={s}>
                {TOLD_LABEL[s]}
              </option>
            ))}
          </select>

          <select
            value={filters.gender}
            onChange={(e) => setFilters((f) => ({ ...f, gender: e.target.value as "" | RequiredGender }))}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">Any gender</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>

          <select
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            className="h-8 max-w-[180px] rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">Any category</option>
            {categoryOptions.map(([name, n]) => (
              <option key={name} value={name}>
                {name} ({n})
              </option>
            ))}
          </select>

          <input
            value={filters.city}
            onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
            placeholder="City…"
            className="h-8 w-28 rounded-lg border border-gray-200 px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />

          <span className="ml-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />

          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Followers</span>
          <Num value={filters.minFollowers} onChange={(v) => setFilters((f) => ({ ...f, minFollowers: v }))} placeholder="min" />
          <Num value={filters.maxFollowers} onChange={(v) => setFilters((f) => ({ ...f, maxFollowers: v }))} placeholder="max" />

          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">ER ≥</span>
          <Num value={filters.minEngagement} onChange={(v) => setFilters((f) => ({ ...f, minEngagement: v }))} placeholder="%" />

          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={filters.hasEmail}
              onChange={(e) => setFilters((f) => ({ ...f, hasEmail: e.target.checked }))}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            Has email
          </label>

          <span className="ml-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {(Object.keys(SORT_LABEL) as SortKey[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>

          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="ml-auto text-[11px] font-semibold text-gray-500 hover:underline dark:text-gray-400"
          >
            Reset
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          Showing {sorted.length} of {rows.length} loaded. A creator we hold no follower count or engagement for is
          never hidden by those filters. Gender hides only a <em>known</em> mismatch — 46% of profiles have no
          gender on file, and treating unknown as a miss would hide half the list.
        </p>
      </div>

      {/* Selection → Excel, and selection → tracker. One selection serves
          both, because they are the same decision: these are the people. */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-3 dark:border-gray-800 dark:bg-gray-900">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer"
            checked={allShownPicked}
            ref={(el) => {
              if (el) {
                const some = sorted.some((c) => selected.has(keyOf(c)));
                el.indeterminate = some && !allShownPicked;
              }
            }}
            onChange={(e) =>
              setSelected((prev) => {
                const next = new Set(prev);
                for (const c of sorted) {
                  if (e.target.checked) next.add(keyOf(c));
                  else next.delete(keyOf(c));
                }
                return next;
              })
            }
          />
          Select all shown ({sorted.length})
        </label>

        <span className="text-[12px] text-gray-500 dark:text-gray-400">
          {selected.size} selected
          {hiddenSelected > 0 && (
            <span className="text-amber-600 dark:text-amber-400"> · {hiddenSelected} hidden by filters, still included</span>
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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => void downloadSelected()}
            disabled={selected.size === 0 || downloading}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
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

          {/* Invite them to the campaign — in the app and by email. Not
              gated on seats: a campaign with no room left is a reason not to
              TRACK somebody, but inviting is how the seats get contested in
              the first place, and the action re-checks capacity-free gates of
              its own (live campaign, open deadline). */}
          <button
            onClick={() => setConfirmInvite((v) => !v)}
            disabled={
              inviting || Boolean(inviteBlocked) || toSend.length === 0 || toSend.length > MAX_INVITE_TOTAL
            }
            title={
              inviteBlocked ||
              (toSend.length > MAX_INVITE_TOTAL
                ? `Up to ${MAX_INVITE_TOTAL} at a time.`
                : reach.alreadyTold > 0 && toSend.length === 0
                  ? "Everyone selected has already been invited to this campaign."
                  : "Send an in-app notification and an email inviting them to this campaign")
            }
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-[13px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300"
          >
            {inviting ? (
              <ButtonSpinner />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            )}
            {inviting && inviteProgress
              ? `Sending ${inviteProgress.done} of ${inviteProgress.total}…`
              : toSend.length > MAX_INVITE_TOTAL
                ? `Up to ${MAX_INVITE_TOTAL} at a time`
                : `Invite to campaign${toSend.length ? ` (${toSend.length})` : ""}`}
          </button>

          {/* Seats full blocks TRACKING, never the messaging: a campaign with
              no room left is still a campaign you might line somebody up for,
              and importFromPool refuses it server-side anyway. */}
          {!seatsFull && (
            <>
              <label className="flex items-center gap-1.5 text-[12px] text-gray-500">
                <span className="hidden sm:inline">Assign to</span>
                <select
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.isApprover ? " (approver)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => void startTracking()}
                disabled={tracking || selected.size === 0 || selected.size > MAX_TRACK || !assignTo}
                title={selected.size > MAX_TRACK ? `Up to ${MAX_TRACK} at a time.` : undefined}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {tracking && <ButtonSpinner />}
                {selected.size > MAX_TRACK ? `Up to ${MAX_TRACK} at a time` : `Start tracking${selected.size ? ` (${selected.size})` : ""}`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mounted on demand, never hidden with a prop: a fresh mount is what
          clears the note between batches, and a reset-on-open effect trips
          react-hooks/set-state-in-effect. Same reason RejectCampaignModal is
          mounted this way. */}
      {confirmInvite && toSend.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5 dark:border-violet-900 dark:bg-violet-950/20">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">
            Invite {toSend.length} creator{toSend.length === 1 ? "" : "s"} to “{campaignTitle}”
          </h2>
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
            {reach.appNotify > 0 && (
              <li>
                <strong>{reach.appNotify}</strong> onboarded creator{reach.appNotify === 1 ? "" : "s"} get a
                notification in the app — which also pushes to their phone — and the campaign appears in their
                list even if the brief would otherwise hide it.
              </li>
            )}
            {reach.email > 0 && (
              <li>
                <strong>{reach.email}</strong> get an email with the brief and a link.
              </li>
            )}
            {reach.noChannel > 0 && (
              <li className="text-amber-700 dark:text-amber-400">
                <strong>{reach.noChannel}</strong> invited-only creator{reach.noChannel === 1 ? "" : "s"} have no
                email on file and no account, so there is no way to reach them from here — they are left out. Use
                the DM button on their row.
              </li>
            )}
            {reach.alreadyTold > 0 && (
              <li className="text-gray-500">
                <strong>{reach.alreadyTold}</strong> of your selection {reach.alreadyTold === 1 ? "has" : "have"}{" "}
                already been invited to this campaign and {reach.alreadyTold === 1 ? "is" : "are"} left out, so
                nobody hears from us twice.
              </li>
            )}
          </ul>
          <label className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Note for them (optional)
          </label>
          <textarea
            value={inviteNote}
            onChange={(e) => setInviteNote(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Anything you want them to know — why you picked them, what the brand is after…"
            className="mt-1 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-[13px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-violet-400 focus:outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            {inviteNote.length}/500 · shown in the email only. This is a real notification on a real phone, so it
            cannot be unsent.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void sendInvites()}
              disabled={inviting}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet-500 disabled:cursor-wait disabled:opacity-60"
            >
              {inviting && <ButtonSpinner />}
              Send {toSend.length} invitation{toSend.length === 1 ? "" : "s"}
            </button>
            <button
              onClick={() => setConfirmInvite(false)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {inviteBlocked && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {inviteBlocked} You can still message creators by DM and download the list.
        </p>
      )}

      {seatsFull && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Every seat on this campaign is taken, so nobody new can be put on the tracker. You can still message
          creators and download the list — raise the slot count on the campaign to add them.
        </p>
      )}

      {/* The message each row's Copy button fills in */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Outreach message</h2>
          <button
            onClick={() => updateMessage(DEFAULT_OUTREACH_MESSAGE)}
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
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{MESSAGE_TOKEN}</code> → their
          name, cleaned of emoji and titles ·{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{FIRST_NAME_TOKEN}</code> →
          just the first word ·{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{HANDLE_TOKEN}</code> →
          @their_handle ·{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{CAMPAIGN_TOKEN}</code> → this
          campaign&apos;s title. Saved in this browser and shared across campaigns, so write it once with{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">{CAMPAIGN_TOKEN}</code> in it.
        </p>
        {sorted[0] && (
          <p className="mt-2 whitespace-pre-line rounded-xl bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Preview · @{sorted[0].handle}
            </span>
            {messageFor(sorted[0])}
          </p>
        )}
      </div>

      {/* Results */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {sorted.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-gray-500 dark:text-gray-400">
            {loading
              ? "Looking through the creator base…"
              : rows.length === 0
                ? "Nobody left to reach out to — everyone matching is already on this campaign, or the search found nothing."
                : "No creator matches those filters. Loosen one, or reset them."}
          </p>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {sorted.map((c) => {
              const k = keyOf(c);
              const tier = tierForFollowers(c.followers);
              const on = selected.has(k);
              return (
                <div
                  key={k}
                  className={`flex flex-wrap items-center gap-3 px-5 py-3 ${on ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleOne(k)}
                    aria-label={`Select ${c.name}`}
                    className="h-4 w-4 shrink-0 cursor-pointer"
                  />
                  <Avatar src={c.photoUrl} name={c.name} size="md" shape="circle" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.handle ? (
                        <a
                          href={`https://instagram.com/${c.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-[13px] font-semibold text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                        >
                          @{c.handle}
                        </a>
                      ) : (
                        <span className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{c.name}</span>
                      )}
                      {tier && <Chip tone={TIER_TONE[tier]}>{tier}</Chip>}
                      {!c.registered && (
                        <Chip tone="bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">invited only</Chip>
                      )}
                      {/* The whole point of the ledger: a row says, on its
                          own, whether we have already written to this person
                          about this campaign. */}
                      {c.inviteResponded ? (
                        <Chip tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          applied
                        </Chip>
                      ) : c.invitedAt ? (
                        <Chip
                          tone="bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                        >
                          invited {invitedAgo(c.invitedAt)}
                        </Chip>
                      ) : null}
                      <Chip tone="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                        {c.score} match
                      </Chip>
                    </div>
                    <p className="truncate text-[12px] text-gray-500 dark:text-gray-400">
                      {[c.name, c.location, c.categories.slice(0, 3).join(", "), c.email].filter(Boolean).join(" · ")}
                    </p>
                    {/* Why this person ranked where they did. */}
                    {c.reasons.length > 0 && (
                      <p className="truncate text-[10px] text-indigo-600 dark:text-indigo-400">{c.reasons.join(" · ")}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-4 text-[12px] text-gray-600 dark:text-gray-300">
                    {c.followers != null ? (
                      <span title={`${nf.format(c.followers)} followers`}>
                        <strong>{compact(c.followers)}</strong> followers
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">— followers</span>
                    )}
                    {c.engagementRate != null && (
                      <span className="hidden sm:inline">{c.engagementRate.toFixed(1)}% ER</span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Copy sits BEFORE the DM link on purpose: the order
                        matches what you do — take the message, then open the
                        thread and paste it. */}
                    <button
                      onClick={() => void copyFor(c)}
                      title={messageFor(c)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                        copied === k
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                      }`}
                    >
                      {copied === k ? (
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
                        Nothing here sends a DM: there is no API for it and
                        scripting Instagram messages would risk the account,
                        so the message is always sent by a human. */}
                    {c.handle && (
                      <a
                        href={`https://ig.me/m/${c.handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.2A7.9 7.9 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        DM
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rows.length >= limit && limit < MAX_LOADED && (
          <div className="border-t border-gray-100 px-5 py-3 text-center dark:border-gray-800">
            <button
              onClick={loadMore}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {loading && <ButtonSpinner />}
              Load {PAGE_SIZE} more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
