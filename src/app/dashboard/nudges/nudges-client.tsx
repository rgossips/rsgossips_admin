"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useConfirmDialog } from "@/components/confirm-dialog";
import {
  AUTO_HOURS_IST,
  AUTO_RUN_LIMIT,
  NUDGE_CHUNK_SIZE,
  NUDGE_COOLDOWN_HOURS,
  NUDGE_GROUPS,
  NUDGES,
  type NudgeKey,
} from "@/lib/nudges/constants";
import type { IgStatus } from "@/lib/instagram-status";
import type { CreatorMatch } from "@/lib/nudges/segments";
import { previewNudge, previewNudgeFor, searchCreatorsForNudge, sendNudgeChunk, sendNudgeTo, setAutoNudges } from "./actions";

export type NudgeCardData = {
  key: NudgeKey;
  eligible: number;
  withEmail: number;
  sentWeek: number;
  recipients: { userId: string; name: string; handle: string | null; hasEmail: boolean; igStatus?: IgStatus }[];
};

const IG_LABEL: Record<IgStatus, string> = {
  authorized: "connected",
  insights_denied: "partial · insights off",
  reconnect: "reconnect needed",
  not_connected: "not connected",
};

type Preview = { subject: string; preview: string; html: string; push: { title: string; text: string; link: string }; sampleOf?: string };
type Progress = { done: number; total: number; email: number; inApp: number; failed: number; skipped: number };
type Status = { kind: "ok" | "error"; text: string };

const fmt = (n: number) => n.toLocaleString("en-IN");

export function NudgesClient({ cards, autoEnabled, live }: { cards: NudgeCardData[]; autoEnabled: boolean | null; live: boolean }) {
  const router = useRouter();
  const confirm = useConfirmDialog();
  const [auto, setAuto] = useState(autoEnabled);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoError, setAutoError] = useState("");
  const [preview, setPreview] = useState<{ key: NudgeKey; data?: Preview; error?: string } | null>(null);
  const [expanded, setExpanded] = useState<NudgeKey | null>(null);
  const [sendingKey, setSendingKey] = useState<NudgeKey | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [status, setStatus] = useState<Partial<Record<NudgeKey, Status>>>({});

  const saveAuto = async (next: boolean) => {
    setAutoSaving(true);
    setAutoError("");
    const res = await setAutoNudges(next);
    setAutoSaving(false);
    if (res.error) setAutoError(res.error);
    else setAuto(next);
  };

  const toggleAuto = () => {
    if (auto) return saveAuto(false);
    confirm.ask({
      title: "Turn on automatic nudges?",
      description: `Every hour between ${AUTO_HOURS_IST.from}:00 and ${AUTO_HOURS_IST.to}:00 IST, up to ${AUTO_RUN_LIMIT} creators who qualify get one nudge each, highest-intent first. The same rules apply as a manual send, including one nudge per creator per ${NUDGE_COOLDOWN_HOURS} hours. You can switch it off any time.`,
      confirmLabel: "Turn on",
      handler: () => saveAuto(true),
    });
  };

  const openPreview = async (key: NudgeKey) => {
    setPreview({ key });
    const res = await previewNudge(key);
    setPreview(res.error || !res.html ? { key, error: res.error || "No preview." } : { key, data: res as Preview });
  };

  const openPreviewFor = async (key: NudgeKey, userId: string) => {
    setPreview({ key });
    const res = await previewNudgeFor(key, userId);
    setPreview(res.error || !res.html ? { key, error: res.error || "No preview." } : { key, data: res as Preview });
  };

  const send = (card: NudgeCardData) => {
    confirm.ask({
      title: `Send "${NUDGES[card.key].label}" to ${fmt(card.eligible)} creator${card.eligible === 1 ? "" : "s"}?`,
      description: `${fmt(card.withEmail)} get the email and all ${fmt(card.eligible)} get an in-app notification (a push on devices where it's on). Anyone who no longer qualifies by the time their turn comes is skipped.`,
      confirmLabel: "Send",
      handler: () => runSend(card),
    });
  };

  const runSend = async (card: NudgeCardData) => {
    const ids = card.recipients.map((r) => r.userId);
    const p: Progress = { done: 0, total: ids.length, email: 0, inApp: 0, failed: 0, skipped: 0 };
    setSendingKey(card.key);
    setProgress({ ...p });
    setStatus((s) => ({ ...s, [card.key]: undefined }));
    let error = "";
    for (let i = 0; i < ids.length; i += NUDGE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + NUDGE_CHUNK_SIZE);
      const res = await sendNudgeChunk(card.key, chunk);
      if (res.error) {
        error = res.error;
        break;
      }
      for (const r of res.results || []) {
        if (r.email === "sent") p.email++;
        if (r.email === "failed") p.failed++;
        if (r.inApp) p.inApp++;
      }
      p.skipped += res.skipped ?? 0;
      p.done += chunk.length;
      setProgress({ ...p });
    }
    setSendingKey(null);
    setProgress(null);
    const summary = `${fmt(p.email)} email${p.email === 1 ? "" : "s"} and ${fmt(p.inApp)} in-app sent${p.failed ? `, ${fmt(p.failed)} email${p.failed === 1 ? "" : "s"} failed` : ""}${p.skipped ? `, ${fmt(p.skipped)} skipped` : ""}.`;
    setStatus((s) => ({ ...s, [card.key]: error ? { kind: "error", text: p.done ? `${error} Stopped after ${fmt(p.done)}: ${summary}` : error } : { kind: "ok", text: summary } }));
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <AutoPanel auto={auto} saving={autoSaving} error={autoError} live={live} onToggle={toggleAuto} />

      <DirectSendPanel
        live={live}
        onPreview={openPreviewFor}
        onAsk={confirm.ask}
        onSent={() => router.refresh()}
      />

      {NUDGE_GROUPS.map((g) => (
        <section key={g.key} className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">{g.title}</h2>
            <p className="text-[12px] text-gray-500">{g.blurb}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards
              .filter((c) => NUDGES[c.key].group === g.key)
              .map((c) => (
                <NudgeCard
                  key={c.key}
                  card={c}
                  live={live}
                  busy={sendingKey !== null}
                  sending={sendingKey === c.key}
                  progress={sendingKey === c.key ? progress : null}
                  status={status[c.key]}
                  expanded={expanded === c.key}
                  onToggleList={() => setExpanded(expanded === c.key ? null : c.key)}
                  onPreview={() => openPreview(c.key)}
                  onSend={() => send(c)}
                />
              ))}
          </div>
        </section>
      ))}

      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
      <ConfirmDialog {...confirm.dialogProps} />
    </div>
  );
}

// Module scope — subcomponents defined inside NudgesClient would remount on
// every progress tick (see CLAUDE.md "Client component pitfalls").

function AutoPanel({ auto, saving, error, live, onToggle }: { auto: boolean | null; saving: boolean; error: string; live: boolean; onToggle: () => void }) {
  const on = !!auto;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Automatic sending</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${on ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
            {on ? "On" : "Off"}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-gray-500">
          {on
            ? `Hourly, ${AUTO_HOURS_IST.from}:00–${AUTO_HOURS_IST.to}:00 IST, up to ${AUTO_RUN_LIMIT} creators a run. Runs on the live site only.`
            : "Off — nothing is sent unless you press Send below. Turn it on to send to qualifying creators every hour."}
        </p>
        {error && <p className="mt-1 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Automatic sending"
        onClick={onToggle}
        disabled={saving || !live || auto === null}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-700"}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

type AskConfig = Parameters<ReturnType<typeof useConfirmDialog>["ask"]>[0];

const IST_SHORT = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Search one creator, pick any template, preview it with their details, send.
// Skips the "who qualifies" rules on purpose — the admin chose this person.
function DirectSendPanel({
  live,
  onPreview,
  onAsk,
  onSent,
}: {
  live: boolean;
  onPreview: (key: NudgeKey, userId: string) => void;
  onAsk: (cfg: AskConfig) => void;
  onSent: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<CreatorMatch[] | null>(null);
  const [picked, setPicked] = useState<CreatorMatch | null>(null);
  const [template, setTemplate] = useState<NudgeKey>("a1");
  const [status, setStatus] = useState<Status | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setStatus(null);
    const res = await searchCreatorsForNudge(query);
    setSearching(false);
    if (res.error) return setStatus({ kind: "error", text: res.error });
    setMatches(res.matches || []);
    setPicked(res.matches?.length === 1 ? res.matches[0] : null);
  };

  const send = () => {
    if (!picked) return;
    const who = picked;
    const key = template;
    onAsk({
      title: `Send "${NUDGES[key].label}" to ${who.name}?`,
      description: `${who.hasEmail ? "They get the email and an in-app notification" : "They have no email, so they get the in-app notification only"}. This skips the usual eligibility rules and the ${NUDGE_COOLDOWN_HOURS}-hour limit.`,
      confirmLabel: "Send",
      handler: async () => {
        const res = await sendNudgeTo(key, who.userId);
        if (res.error || !res.result) return setStatus({ kind: "error", text: res.error || "Sending failed." });
        const r = res.result;
        const parts = [r.email === "sent" ? "email sent" : r.email === "failed" ? `email failed (${r.error || "unknown error"})` : "no email on file", r.inApp ? "in-app sent" : "in-app failed"];
        setStatus({ kind: r.email === "failed" || !r.inApp ? "error" : "ok", text: `${who.name}: ${parts.join(", ")}.` });
        onSent();
      },
    });
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-sm font-bold text-gray-900 dark:text-white">Send to a specific creator</h2>
      <p className="text-[12px] text-gray-500">Search by name, @handle, email or phone, pick any template, preview it with their details and send.</p>

      <form onSubmit={search} className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Priya, @handle, 98765…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-800"
        />
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          className="h-9 rounded-lg bg-gray-900 px-4 text-[13px] font-semibold text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {matches && matches.length === 0 && <p className="mt-3 text-[12px] text-gray-500">No creators match “{query}”.</p>}
      {matches && matches.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {matches.map((m) => {
            const active = picked?.userId === m.userId;
            return (
              <li key={m.userId}>
                <button
                  type="button"
                  onClick={() => setPicked(m)}
                  className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-[12px] cursor-pointer ${active ? "bg-indigo-50 dark:bg-indigo-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/60"}`}
                >
                  <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${active ? "border-indigo-600 bg-indigo-600" : "border-gray-300 dark:border-gray-600"}`} />
                  <span className="font-semibold text-gray-900 dark:text-white">{m.name}</span>
                  {m.handle && <span className="text-gray-400">@{m.handle}</span>}
                  <span className={m.email ? "text-gray-600 dark:text-gray-300" : "italic text-gray-400"}>{m.email || "no email"}</span>
                  <span className="ml-auto flex flex-wrap gap-1.5 text-[10px]">
                    <Chip>{m.hasEmail ? "email + app" : "app only"}</Chip>
                    <Chip>{IG_LABEL[m.igStatus]}</Chip>
                    {m.subscribed && <Chip tone="green">subscribed</Chip>}
                    {m.blocked && <Chip tone="red">{m.blocked === "opted_out" ? "unsubscribed" : "suspended"}</Chip>}
                    {m.lastNudge && <Chip>last nudge {m.lastNudge.key.toUpperCase()} · {IST_SHORT.format(new Date(m.lastNudge.at))}</Chip>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picked && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[12px] font-semibold text-gray-600 dark:text-gray-300" htmlFor="direct-template">
            Template
          </label>
          <select
            id="direct-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value as NudgeKey)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800"
          >
            {NUDGE_GROUPS.map((g) => (
              <optgroup key={g.key} label={g.title}>
                {(Object.keys(NUDGES) as NudgeKey[])
                  .filter((k) => NUDGES[k].group === g.key)
                  .map((k) => (
                    <option key={k} value={k}>{NUDGES[k].label}</option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onPreview(template, picked.userId)}
            className="h-9 rounded-lg border border-gray-200 px-4 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!live || !!picked.blocked}
            title={picked.blocked ? (picked.blocked === "opted_out" ? "This creator unsubscribed" : "This creator is suspended") : undefined}
            className="h-9 rounded-lg bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send to {picked.name.split(/\s+/)[0]}
          </button>
        </div>
      )}

      {status && (
        <p role="status" className={`mt-3 text-[12px] ${status.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {status.text}
        </p>
      )}
    </section>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "green" | "red" }) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : tone === "red"
        ? "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  return <span className={`rounded-full px-2 py-0.5 font-semibold ${cls}`}>{children}</span>;
}

function NudgeCard({
  card,
  live,
  busy,
  sending,
  progress,
  status,
  expanded,
  onToggleList,
  onPreview,
  onSend,
}: {
  card: NudgeCardData;
  live: boolean;
  busy: boolean;
  sending: boolean;
  progress: Progress | null;
  status?: Status;
  expanded: boolean;
  onToggleList: () => void;
  onPreview: () => void;
  onSend: () => void;
}) {
  const meta = NUDGES[card.key];
  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-[13px] font-bold text-gray-900 dark:text-white">{meta.label}</h3>
      <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{meta.rule}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Eligible now" value={card.eligible} strong />
        <Stat label="With email" value={card.withEmail} />
        <Stat label="Sent · 7 days" value={card.sentWeek} />
      </div>

      {card.eligible > 0 && (
        <button type="button" onClick={onToggleList} className="mt-2 self-start text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer dark:text-indigo-400">
          {expanded ? "Hide creators" : `Show ${fmt(card.eligible)} creator${card.eligible === 1 ? "" : "s"}`}
        </button>
      )}
      {expanded && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-100 text-[12px] dark:border-gray-800">
          {card.recipients.map((r) => (
            <li key={r.userId} className="flex items-center justify-between gap-2 border-b border-gray-50 px-2.5 py-1.5 last:border-0 dark:border-gray-800">
              <a href={`/dashboard/influencers/${r.userId}`} className="truncate text-gray-700 hover:text-indigo-600 dark:text-gray-200">
                {r.name}
                {r.handle ? <span className="text-gray-400"> · @{r.handle}</span> : null}
              </a>
              <span className="shrink-0 text-[10px] text-gray-400">
                {r.igStatus ? `${IG_LABEL[r.igStatus]} · ` : ""}
                {r.hasEmail ? "email + app" : "app only"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {progress && (
        <p className="mt-3 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400" role="status">
          Sending {fmt(progress.done)} of {fmt(progress.total)}…
        </p>
      )}
      {status && (
        <p role="status" className={`mt-3 text-[12px] ${status.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {status.text}
        </p>
      )}

      <div className="mt-auto flex gap-2 pt-4">
        <button
          type="button"
          onClick={onPreview}
          className="h-9 flex-1 rounded-lg border border-gray-200 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={!live || busy || card.eligible === 0}
          aria-busy={sending}
          className="h-9 flex-1 rounded-lg bg-indigo-600 text-[13px] font-semibold text-white hover:bg-indigo-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : card.eligible ? `Send to ${fmt(card.eligible)}` : "No one eligible"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-800/60">
      <div className={`tabular-nums ${strong ? "text-lg font-black text-gray-900 dark:text-white" : "text-base font-bold text-gray-700 dark:text-gray-200"}`}>{fmt(value)}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

function PreviewModal({ preview, onClose }: { preview: { key: NudgeKey; data?: Preview; error?: string }; onClose: () => void }) {
  const d = preview.data;
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl lg:inset-auto lg:left-1/2 lg:top-1/2 lg:h-[88vh] lg:w-full lg:max-w-2xl lg:-translate-x-1/2 lg:-translate-y-1/2 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{NUDGES[preview.key].label}</p>
            {d ? (
              <>
                <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{d.subject}</p>
                <p className="truncate text-[12px] text-gray-500">{d.preview}</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">{preview.error || "Loading preview…"}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 cursor-pointer dark:hover:bg-gray-800" aria-label="Close preview">
            ✕
          </button>
        </div>
        {d && (
          <>
            <div className="border-b border-gray-100 bg-gray-50 px-5 py-2.5 text-[12px] dark:border-gray-800 dark:bg-gray-800/40">
              <span className="font-bold text-gray-700 dark:text-gray-200">In-app / push: </span>
              <span className="font-semibold text-gray-900 dark:text-white">{d.push.title}</span>
              <span className="text-gray-600 dark:text-gray-300"> — {d.push.text}</span>
              <span className="text-gray-400"> → {d.push.link}</span>
            </div>
            <p className="px-5 pt-2 text-[11px] text-gray-400">
              {d.sampleOf ? `Shown with ${d.sampleOf}'s details — each creator gets their own name and numbers.` : "Nobody is eligible yet, so this uses sample details."}
            </p>
            {/* sandbox with no permissions: the email can't run script or navigate this page. */}
            <iframe title="Email preview" sandbox="" srcDoc={d.html} className="min-h-0 w-full flex-1 bg-[#F4F5F8]" />
          </>
        )}
      </div>
    </>
  );
}
