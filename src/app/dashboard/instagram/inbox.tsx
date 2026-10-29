"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { ButtonSpinner } from "@/components/spinner";
import {
  IG_CALLBACK_PATH,
  IG_DM_SCOPES,
  THREAD_FILTER_HINT,
  THREAD_FILTER_LABEL,
  type ThreadFilter,
} from "@/lib/instagram-dm/constants";
import {
  connectInstagramWithToken,
  disconnectInstagramAccount,
  getInstagramThread,
  listInstagramThreads,
  refreshInstagramToken,
  setInstagramThreadArchived,
  syncInstagramMessages,
  type IgAccount,
  type IgMessageRow,
  type IgThreadRow,
} from "./actions";

const FILTERS: ThreadFilter[] = ["all", "replied", "awaiting", "unanswered", "archived"];

// Fixed IST, so the server and the client print the same string and there is
// no hydration mismatch — the rule the status and errors pages follow.
const WHEN = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const fmt = (iso: string | null | undefined) => (iso ? `${WHEN.format(new Date(iso))}` : "—");

// Module scope: a subcomponent declared inside a stateful parent is a new
// component on every render, which remounts its children (CLAUDE.md).
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

function Bubble({ msg }: { msg: IgMessageRow }) {
  const mine = msg.direction === "out";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
          mine
            ? "bg-indigo-600 text-white"
            : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
        }`}
      >
        {msg.body ? (
          <span className="whitespace-pre-wrap break-words">{msg.body}</span>
        ) : (
          // An attachment-only message has no text at all. An empty bubble
          // would read as a bug rather than as a shared reel.
          <span className="italic opacity-70">{msg.hasAttachment ? "sent an attachment" : "no text"}</span>
        )}
        <span className={`mt-0.5 block text-[10px] ${mine ? "text-indigo-100" : "text-gray-400"}`}>
          {fmt(msg.sentAt)}
        </span>
      </div>
    </div>
  );
}

/** How many days until the stored token stops working. */
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / 86_400_000);
}

export function InstagramInbox({ account }: { account: IgAccount | null }) {
  const [threads, setThreads] = useState<IgThreadRow[]>([]);
  const [counts, setCounts] = useState<Record<ThreadFilter, number> | null>(null);
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMsgs, setOpenMsgs] = useState<IgMessageRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (opts?: { filter?: ThreadFilter; search?: string }) => {
    setLoading(true);
    const res = await listInstagramThreads({
      filter: opts?.filter ?? filter,
      search: opts?.search ?? search,
    });
    setLoading(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    setThreads(res.threads || []);
    setCounts(res.counts || null);
  };

  // One load on mount, and only when an account is actually connected.
  // The dependency list is empty on purpose: `load` reads the current filter
  // and search from state, and re-running on either would fire a request per
  // keystroke.
  useEffect(() => {
    if (account) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFilter = (f: ThreadFilter) => {
    setFilter(f);
    setOpenId(null);
    void load({ filter: f });
  };

  const openThread = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setOpenMsgs(null);
      return;
    }
    setOpenId(id);
    setOpenMsgs(null);
    const res = await getInstagramThread(id);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    setOpenMsgs(res.messages || []);
  };

  const sync = async () => {
    setSyncing(true);
    setMsg(null);
    setNote(null);
    const res = await syncInstagramMessages();
    setSyncing(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    setNote(
      [
        `Read ${res.threads ?? 0} conversation${res.threads === 1 ? "" : "s"}`,
        res.newMessages ? `${res.newMessages} new message${res.newMessages === 1 ? "" : "s"}` : "nothing new",
        res.unreadable
          ? `${res.unreadable} message${res.unreadable === 1 ? "" : "s"} too old for Instagram to serve`
          : null,
        res.partial ? "stopped on the time limit — sync again for the rest" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    await load();
  };

  const archive = async (id: string, archived: boolean) => {
    setBusy(true);
    const res = await setInstagramThreadArchived(id, archived);
    setBusy(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    await load();
  };

  const extend = async () => {
    setBusy(true);
    setMsg(null);
    const res = await refreshInstagramToken();
    setBusy(false);
    if (res.error) {
      setMsg(res.error);
      return;
    }
    setNote("Connection extended for another 60 days.");
  };

  const disconnect = async () => {
    setBusy(true);
    const res = await disconnectInstagramAccount();
    setBusy(false);
    if (res.error) setMsg(res.error);
  };

  // ── Not connected ─────────────────────────────────────────────────────
  if (!account) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center dark:border-gray-800 dark:bg-gray-900">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">No Instagram account connected</p>
        <p className="mx-auto mt-1 max-w-lg text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
          Connect the account you DM creators from. It must be a <strong>Professional</strong> account (Business or
          Creator) — a personal account has no messaging API at all. Only you will see its threads.
        </p>
        {msg && <p className="mt-3 text-[13px] text-rose-600 dark:text-rose-400">{msg}</p>}
        <ConnectButton className="mt-5" />
        <TokenConnect />
      </div>
    );
  }

  const left = daysLeft(account.tokenExpiresAt);
  const expired = left != null && left < 0;

  return (
    <div className="space-y-4">
      {/* The connection, and whether it is actually working. */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        <Avatar src={account.profilePictureUrl} name={account.username || "Instagram"} size="md" shape="circle" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-gray-900 dark:text-white">
            @{account.username || account.igUserId}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {account.lastSyncedAt ? `Last read ${fmt(account.lastSyncedAt)} IST` : "Never read"}
            {left != null && (
              <>
                {" · "}
                <span className={expired ? "text-rose-600 dark:text-rose-400" : left < 10 ? "text-amber-600 dark:text-amber-400" : ""}>
                  {expired ? "connection expired" : `${left} day${left === 1 ? "" : "s"} left on the connection`}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => void sync()}
            disabled={syncing || expired || !account.canReadMessages}
            title={
              expired
                ? "Reconnect the account first."
                : !account.canReadMessages
                  ? "This connection cannot read messages yet."
                  : "Read new messages from Instagram now"
            }
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing && <ButtonSpinner />}
            {syncing ? "Reading…" : "Sync messages"}
          </button>
          {left != null && left < 20 && !expired && (
            <button
              onClick={() => void extend()}
              disabled={busy}
              className="rounded-xl border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Extend 60 days
            </button>
          )}
          {expired && <ConnectButton label="Reconnect" />}
          <button
            onClick={() => void disconnect()}
            disabled={busy}
            className="rounded-xl border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Disconnect
          </button>
        </div>
      </div>

      {!account.canReadMessages && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>This connection cannot read messages.</strong> The account is linked, but Instagram did not grant
          the messaging permission — so there is nothing to sync. Two things to check in the Meta app dashboard:{" "}
          <code className="font-mono">{IG_DM_SCOPES[1]}</code> is added to the Instagram use case, and this Instagram
          account is listed under the app as one you own. Then press Reconnect.
          {account.lastError ? <span className="mt-1 block opacity-80">{account.lastError}</span> : null}
        </p>
      )}

      {account.canReadMessages && account.lastError && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
          Last sync failed: {account.lastError}
        </p>
      )}

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

      {/* Filters. Every count comes from one read of the whole set, so a tab
          cannot read 0 over a list with rows in it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => pickFilter(f)}
            title={THREAD_FILTER_HINT[f]}
            className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${
              filter === f
                ? "bg-indigo-600 text-white"
                : "bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {THREAD_FILTER_LABEL[f]}
            {counts && <span className="ml-1 font-normal opacity-60">{counts[f]}</span>}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) void load();
            }}
            placeholder="Find a handle or name…"
            className="h-8 w-44 rounded-lg border border-gray-200 px-2 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
          >
            {loading ? "…" : "Search"}
          </button>
        </div>
      </div>

      {/* Threads */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {threads.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-gray-500 dark:text-gray-400">
            {loading
              ? "Loading…"
              : account.lastSyncedAt
                ? "No conversation matches that."
                : "Nothing read yet — press Sync messages to pull your threads in."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {threads.map((t) => (
              <li key={t.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => void openThread(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void openThread(t.id);
                    }
                  }}
                  // A role="button" container rather than a <button> wrapper:
                  // it contains links and buttons of its own, and nesting
                  // those inside a button is invalid HTML — the same shape
                  // the pending-invitation card uses.
                  className={`flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left ${
                    openId === t.id ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""
                  }`}
                >
                  <Avatar src={null} name={t.name || t.username || "?"} size="md" shape="circle" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">
                        {t.username ? `@${t.username}` : t.name || "Unknown"}
                      </span>
                      {t.lastDirection === "in" && (
                        <Chip tone="bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          waiting on us
                        </Chip>
                      )}
                      {!t.hasInbound && (
                        <Chip tone="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">no reply yet</Chip>
                      )}
                      {t.creator && (
                        <Chip tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          {t.creator.influencerId ? "registered creator" : "invited creator"}
                        </Chip>
                      )}
                    </div>
                    <p className="truncate text-[12px] text-gray-500 dark:text-gray-400">
                      {t.lastMessageText || "No message text"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-gray-400">
                    <div>{fmt(t.lastMessageAt)}</div>
                    <div>
                      {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-2"
                    // The children must not re-trigger the row's own open.
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.creator?.influencerId && (
                      <Link
                        href={`/dashboard/influencers/${t.creator.influencerId}`}
                        className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300"
                      >
                        Profile
                      </Link>
                    )}
                    {t.username && (
                      <a
                        href={`https://ig.me/m/${t.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300"
                      >
                        Reply in Instagram
                      </a>
                    )}
                    <button
                      onClick={() => void archive(t.id, !t.isArchived)}
                      disabled={busy}
                      className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-gray-400 hover:bg-gray-50 disabled:opacity-60 dark:hover:bg-gray-800"
                    >
                      {t.isArchived ? "Unarchive" : "Archive"}
                    </button>
                  </div>
                </div>

                {openId === t.id && (
                  <div className="space-y-2 border-t border-gray-100 bg-gray-50/60 px-5 py-4 dark:border-gray-800 dark:bg-gray-950/40">
                    {openMsgs === null ? (
                      <p className="text-center text-[12px] text-gray-400">Loading the conversation…</p>
                    ) : openMsgs.length === 0 ? (
                      <p className="text-center text-[12px] text-gray-400">
                        No messages stored for this thread yet. Instagram only serves the 20 most recent per
                        conversation — sync regularly and history builds up here.
                      </p>
                    ) : (
                      openMsgs.map((m) => <Bubble key={m.id} msg={m} />)
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The other way in: paste a token generated in the Meta App Dashboard.
 *
 * Kept behind a `<details>` rather than shown outright — OAuth is the right
 * default for a team, and a token box offered first invites people to paste
 * a credential into a form out of habit. But for company-owned accounts it
 * is both the SHORTER path (the dashboard hands out a 60-day token directly;
 * OAuth's first token lasts an hour and has to be exchanged) and the one
 * that works when the app's OAuth redirect URIs are not set up, which is the
 * wall most people hit first.
 */
function TokenConnect() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const res = await connectInstagramWithToken(token);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    // Clear it immediately on success: there is no reason for a live access
    // token to sit in a DOM node after it has been stored.
    setToken("");
    window.location.reload();
  };

  return (
    <details className="mx-auto mt-5 max-w-lg text-left">
      <summary className="text-[12px] font-semibold text-gray-500 hover:underline dark:text-gray-400">
        Or paste a token from the Meta App Dashboard
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
          In the Meta App Dashboard: <strong>Instagram → API setup with Instagram business login → Generate token</strong>{" "}
          beside the account. That hands you a 60-day token and needs no OAuth redirect URI, which is the quickest way
          in for an account we own.
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the access token"
          className="h-10 w-full rounded-xl border border-gray-200 px-3 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          onClick={() => void save()}
          disabled={busy || token.trim().length < 20}
          className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          {busy && <ButtonSpinner />}
          {busy ? "Checking…" : "Save token"}
        </button>
        {err && <p className="text-[12px] leading-relaxed text-rose-600 dark:text-rose-400">{err}</p>}
      </div>
    </details>
  );
}

/**
 * Starts the OAuth hop.
 *
 * The redirect_uri is built from `window.location.origin` so it always
 * matches the host the admin is actually on — the same trick the consumer
 * app's `/api/auth/instagram` route uses, and what lets this work on
 * localhost and on Netlify without a per-environment constant. Both origins
 * still have to be listed as valid redirect URIs on the Meta app.
 */
function ConnectButton({ className = "", label = "Connect Instagram" }: { className?: string; label?: string }) {
  const [err, setErr] = useState<string | null>(null);
  const appId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID;

  const go = () => {
    if (!appId) {
      setErr("NEXT_PUBLIC_INSTAGRAM_APP_ID is not set on this server, so the Instagram hand-off cannot start.");
      return;
    }
    const redirectUri = `${window.location.origin}${IG_CALLBACK_PATH}`;
    const url =
      "https://www.instagram.com/oauth/authorize" +
      "?force_reauth=true" +
      `&client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(IG_DM_SCOPES.join(","))}` +
      "&response_type=code";
    window.location.assign(url);
  };

  return (
    <div className={className}>
      <button
        onClick={go}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.22 1 .5 1.4.9.4.4.7.8.9 1.4.17.4.37 1 .42 2.2.06 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.05 1.2-.25 1.8-.42 2.2-.22.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.17-1 .37-2.2.42-1.3.06-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.05-1.8-.25-2.2-.42-.6-.22-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.17-.4-.37-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.05-1.2.25-1.8.42-2.2.22-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.17 1-.37 2.2-.42C8.4 2.2 8.8 2.2 12 2.2zm0 5.1a4.7 4.7 0 100 9.4 4.7 4.7 0 000-9.4zm0 7.75a3.05 3.05 0 110-6.1 3.05 3.05 0 010 6.1zm6-7.94a1.1 1.1 0 11-2.2 0 1.1 1.1 0 012.2 0z" />
        </svg>
        {label}
      </button>
      {err && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{err}</p>}
    </div>
  );
}
