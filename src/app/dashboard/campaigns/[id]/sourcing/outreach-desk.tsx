"use client";

import { useMemo, useState } from "react";
import { InstagramLink } from "@/components/instagram-link";
import { PIPELINE, LEGACY_PIPELINE, DROPPED, STAGE_STYLE, stageSpec, stageIndex, isLegacyStage } from "@/lib/sourcing/stages";
import { actorFor } from "@/lib/sourcing/outreach";
import { OutreachControl, OwnerControl, type OutreachContext } from "./outreach-control";

// The outreach desk: tiles, list and detail in one client component.
//
// Selection, scope, search and the stage filter are CLIENT state rather
// than URL params. Every one of them re-filters a list that is already in
// memory — a campaign's bookings are tens of rows, not thousands — so a
// server round trip per keystroke would add 250ms (Supabase is in Mumbai,
// this runs as a function elsewhere) to answer a question the browser can
// already answer. The trade is that a filtered view is not shareable by
// link, which nobody has asked for.
//
// Activity comes down with the page for the same reason: ~140 events across
// a campaign is nothing, and loading them per selection would put a spinner
// in front of every click.

// One row of the pipeline. Lived in sourcing-table.tsx until that table
// was replaced by this desk.
export type Booking = {
  id: string;
  instagram_username: string;
  creator_name: string | null;
  email: string | null;
  phone: string | null;
  tier: string | null;
  followers_count: number | null;
  platform: string | null;
  stage: string;
  quoted_fee_paise: number | null;
  agreed_fee_paise: number | null;
  product_cost_paise: number | null;
  influencer_id: string | null;
  invitation_id: string | null;
  live_url: string | null;
  payout_mode: string | null;
  payout_detail: string | null;
  contacted_channel: string | null;
  assigned_to: string | null;
  // Set on the server: they also applied through the portal, so that row
  // holds the seat independently of this booking.
  hasApplication?: boolean;
  created_at: string;
};

export type BookingEvent = { booking_id: string; note: string; actorName: string; at: string };

const rupees = (paise: number | null | undefined) =>
  paise == null ? "—" : `₹${Math.round(Number(paise) / 100).toLocaleString("en-IN")}`;

// The selected tile is marked with a RING, not a thicker border. A border
// takes part in layout, so going from 1px to 2px narrowed the content box
// by 2px, which was enough to rewrap "Product & reimburse" onto a second
// line and shove every tile after it along. A ring is a box-shadow: it
// draws over the edge and changes nothing about the size. (The HTML mock
// solved the same problem by pairing border:2px with margin:0 against
// border:1px with margin:1px — same idea, one fewer moving part here.)
const TILE = "flex min-h-[76px] flex-none flex-col justify-between gap-1.5 rounded-xl border p-2.5 text-left";
const CARD = "rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900";

export function OutreachDesk({
  bookings,
  ctx,
  events,
}: {
  bookings: Booking[];
  ctx: OutreachContext;
  events: Record<string, BookingEvent[]>;
}) {
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<string | null>(null);

  const needsMe = useMemo(() => {
    return (b: Booking) => {
      const who = actorFor(b);
      if (who.kind === "none") return false;
      if (who.kind === "approver") return ctx.actor.isApprover || ctx.actor.isSuperAdmin;
      return !!b.assigned_to && b.assigned_to === ctx.actor.actorId;
    };
  }, [ctx.actor]);

  const myCount = useMemo(() => bookings.filter(needsMe).length, [bookings, needsMe]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      // "All active" hides the finished and the abandoned — they are
      // history, and leaving them in means scrolling past last month's work
      // to reach this week's.
      if (stageFilter === "all") {
        // handed_off joins closed and dropped here: the tracker is done
        // with them. They remain reachable through their own tile, which
        // is the point of keeping it — "who did we put on this campaign"
        // is a real question, it is just not a queue.
        if (b.stage === "closed" || b.stage === "dropped" || b.stage === "handed_off") return false;
      } else if (b.stage !== stageFilter) return false;
      if (scope === "mine" && !needsMe(b)) return false;
      if (q && !`${b.creator_name || ""} ${b.instagram_username}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bookings, stageFilter, scope, query, needsMe]);

  const countFor = (id: string) =>
    id === "all"
      ? bookings.filter(
          (b) => b.stage !== "closed" && b.stage !== "dropped" && b.stage !== "handed_off",
        ).length
      : bookings.filter((b) => b.stage === id).length;

  const selected = selId ? bookings.find((b) => b.id === selId) || null : null;

  // The live ladder, in order, ending at "On the campaign" — that is where
  // the tracker finishes, so nothing may sit to the right of it and read as
  // a later step.
  //
  // The legacy stages follow Dropped and ONLY when a booking is still in
  // one. They are real and reachable, so hiding them outright would strand
  // those rows; showing an empty one would re-suggest a path nothing takes
  // any more.
  const tiles = [
    { id: "all", label: "All active", actor: "" },
    ...PIPELINE.map((s) => ({
      id: s.id,
      label: s.label,
      actor: s.actor === "approver" ? ctx.approverName : s.actor ? "Team" : "",
    })),
    { id: DROPPED.id, label: DROPPED.label, actor: "" },
    ...LEGACY_PIPELINE.filter((s) => bookings.some((b) => b.stage === s.id)).map((s) => ({
      id: s.id,
      label: s.label,
      actor: s.actor === "approver" ? ctx.approverName : s.actor ? "Team" : "",
    })),
  ];

  return (
    <div className="space-y-4">
      {/* Stage tiles. A horizontal strip that scrolls on a phone and wraps
          to a grid from md up — the counts are the thing an admin checks
          first, so they stay visible rather than hiding behind a dropdown. */}
      {/* The negative margin and padding are not decoration: this scrolls
          horizontally, and `overflow-x: auto` forces `overflow-y` to compute
          as auto too — CSS cannot clip one axis and leave the other visible.
          The selected tile's ring is drawn OUTSIDE its box, so without room
          on every side the scroll container shears it off. px-1 covers the
          sides; py-1 covers the top and bottom, which pb-1 alone did not. */}
      <nav aria-label="Pipeline stages" className="-mx-1 overflow-x-auto px-1 py-1">
        <div className="flex gap-2 md:grid md:grid-cols-6 lg:grid-cols-11">
          {tiles.map((t) => {
            const on = stageFilter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setStageFilter(t.id)}
                className={`${TILE} w-[118px] md:w-auto ${
                  on
                    ? "border-emerald-700 ring-2 ring-emerald-700 bg-white dark:bg-gray-900"
                    : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900"
                }`}
              >
                <span className="text-[12px] font-medium leading-tight text-gray-700 dark:text-gray-300">{t.label}</span>
                <span className="flex w-full items-baseline justify-between gap-1.5">
                  <span className="text-[22px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {countFor(t.id)}
                  </span>
                  {t.actor && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        t.actor === ctx.approverName
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                      }`}
                    >
                      {t.actor}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-wrap items-start gap-5">
        {/* The list. Hidden on a phone while a creator is open, so the
            detail reads as a full screen rather than something below a long
            list you have to scroll past. */}
        <section className={`min-w-0 flex-[999_1_560px] ${selected ? "hidden lg:block" : ""}`}>
          <div className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-gray-100 p-3.5 dark:border-gray-800">
              <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                {(["all", "mine"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setScope(s);
                      if (s === "mine") setStageFilter("all");
                    }}
                    className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${
                      scope === s
                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
                        : "text-gray-500"
                    }`}
                  >
                    {s === "all" ? "All creators" : `Needs my action · ${myCount}`}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or handle"
                aria-label="Search creators"
                // 16px on phones: anything smaller makes iOS zoom the page
                // on focus, which then needs a pinch to undo.
                className="h-10 w-full rounded-lg border border-gray-300 px-3 text-base sm:w-64 sm:text-sm dark:border-gray-700 dark:bg-gray-950"
              />
            </div>

            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">
                Nothing here. Try another stage or clear the search.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelId(b.id)}
                      aria-pressed={b.id === selId}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 p-3.5 text-left lg:grid-cols-[minmax(180px,2fr)_120px_100px_100px_150px_minmax(150px,1.3fr)] lg:items-center ${
                        b.id === selId
                          ? "bg-emerald-50/70 dark:bg-emerald-900/20"
                          : needsMe(b)
                            ? "bg-amber-50/40 dark:bg-amber-900/10"
                            : "hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
                      }`}
                    >
                      <span className="col-start-1 flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {b.creator_name || "—"}
                        </span>
                        <span className="truncate text-[12px] text-gray-500">
                          @{b.instagram_username}
                          {b.platform ? ` · ${b.platform}` : ""}
                        </span>
                      </span>

                      {/* Owner / proposed / agreed are their own columns from
                          lg up and collapse into one meta line below it. */}
                      <span className="hidden text-[12px] text-gray-600 lg:block dark:text-gray-300">
                        {ctx.admins.find((a) => a.id === b.assigned_to)?.name || "—"}
                      </span>
                      <span className="hidden text-[13px] tabular-nums text-gray-600 lg:block dark:text-gray-300">
                        {rupees(b.quoted_fee_paise)}
                      </span>
                      <span className="hidden text-[13px] font-semibold tabular-nums text-gray-800 lg:block dark:text-gray-200">
                        {rupees(b.agreed_fee_paise)}
                      </span>

                      <span className="col-start-2 row-start-1 justify-self-end lg:col-start-auto lg:row-start-auto lg:justify-self-auto">
                        <StageChip stage={b.stage} />
                      </span>

                      <span className="col-span-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-gray-500 lg:hidden">
                        <span>{ctx.admins.find((a) => a.id === b.assigned_to)?.name || "Unassigned"}</span>
                        <span className="tabular-nums">Proposed {rupees(b.quoted_fee_paise)}</span>
                        {b.agreed_fee_paise != null && (
                          <span className="tabular-nums">Agreed {rupees(b.agreed_fee_paise)}</span>
                        )}
                      </span>

                      <span className="col-span-2 flex flex-col lg:col-span-1">
                        <span className="text-[12px] text-gray-700 dark:text-gray-300">{stageSpec(b.stage).next}</span>
                        <WaitingLine b={b} ctx={ctx} mine={needsMe(b)} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {selected && <DetailPanel b={selected} ctx={ctx} events={events[selected.id] || []} onBack={() => setSelId(null)} />}
      </div>
    </div>
  );
}

function StageChip({ stage }: { stage: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_STYLE[stage]}`}
    >
      {stageSpec(stage).label}
    </span>
  );
}

function WaitingLine({ b, ctx, mine }: { b: Booking; ctx: OutreachContext; mine: boolean }) {
  const who = actorFor(b);
  if (who.kind === "none") return null;
  if (mine) return <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Your move</span>;
  const label =
    who.kind === "approver"
      ? ctx.approverName
      : ctx.admins.find((a) => a.id === b.assigned_to)?.name || "nobody";
  return <span className="text-[11px] text-gray-400">Waiting on {label}</span>;
}

function DetailPanel({
  b,
  ctx,
  events,
  onBack,
}: {
  b: Booking;
  ctx: OutreachContext;
  events: BookingEvent[];
  onBack: () => void;
}) {
  const spec = stageSpec(b.stage);
  const idx = stageIndex(b.stage);
  const legacy = isLegacyStage(b.stage);
  const owner = ctx.admins.find((a) => a.id === b.assigned_to);
  const who = actorFor(b);

  // Agreed against proposed, as a percentage. Only when both exist — a
  // delta against nothing is not a delta.
  const proposed = b.quoted_fee_paise;
  const agreed = b.agreed_fee_paise;
  const delta = proposed && agreed ? Math.round(((agreed - proposed) / proposed) * 100) : null;
  const deltaText = delta === null ? "" : delta === 0 ? "on proposal" : `${delta > 0 ? "+" : ""}${delta}% vs proposed`;

  const settlement =
    b.payout_mode === "Cash"
      ? `Paid ${rupees(agreed)}`
      : b.payout_mode === "Barter"
        ? `Barter: ${b.payout_detail || "—"}`
        : "—";

  const waiting =
    who.kind === "none"
      ? b.stage === "closed"
        ? "This collaboration is complete."
        : "This creator is no longer being pursued."
      : who.kind === "approver"
        ? `Waiting on ${ctx.approverName}.`
        : `Waiting on ${owner?.name || "nobody — assign them"}.`;

  return (
    <aside aria-label="Creator detail" className="w-full min-w-0 flex-[1_1_380px] space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-[13px] font-medium lg:hidden dark:border-gray-700"
      >
        ← Back to list
      </button>

      <div className={`${CARD} space-y-3.5 p-5`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{b.creator_name || "—"}</h2>
            <p className="text-[13px] text-gray-500">
              <InstagramLink handle={b.instagram_username} />
              {b.platform ? ` · ${b.platform}` : ""}
            </p>
            <p className="text-[13px] text-gray-500">
              Owner: {owner?.name || "unassigned"} · Contact via {b.contacted_channel || "not contacted yet"}
            </p>
          </div>
          <StageChip stage={b.stage} />
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3.5 dark:border-gray-800 dark:bg-gray-800/30">
          <div>
            <dt className="text-[12px] text-gray-500">Proposed quote</dt>
            <dd className="text-[16px] font-medium tabular-nums">{rupees(proposed)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-gray-500">Agreed quote</dt>
            <dd className="text-[16px] font-medium tabular-nums">
              {rupees(agreed)} <span className="text-[12px] font-normal text-gray-400">{deltaText}</span>
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-gray-500">Product reimbursed</dt>
            <dd className="tabular-nums">{rupees(b.product_cost_paise)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-gray-500">Settlement</dt>
            <dd className="text-[13px]">{settlement}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[12px] text-gray-500">Content</dt>
            <dd className="break-all text-[13px]">
              {b.live_url ? (
                <a href={b.live_url} target="_blank" rel="noreferrer noopener" className="text-emerald-700 underline dark:text-emerald-400">
                  {b.live_url}
                </a>
              ) : (
                <span className="text-gray-400">Not submitted yet</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
              Next step
            </p>
            <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">{spec.next}</p>
            <p className="text-[13px] text-gray-600 dark:text-gray-400">{waiting}</p>
          </div>
          <OutreachControl row={b} ctx={ctx} />
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-gray-400">Owner</p>
          <OwnerControl row={b} ctx={ctx} />
        </div>
      </div>

      <div className={`${CARD} space-y-2.5 p-5`}>
        <h3 className="text-sm font-semibold">Progress</h3>
        <ol className="space-y-1.5">
          {PIPELINE.map((s, k) => {
            // A legacy booking is not on this ladder at all — stageIndex
            // gives -1 — so it is shown as having cleared the live path it
            // did pass through, with its real stage named beneath.
            const done = b.stage === "closed" || legacy ? true : idx > k;
            const cur = b.stage !== "closed" && !legacy && idx === k;
            return (
              <li
                key={s.id}
                className={`flex items-center gap-2.5 text-[13px] ${
                  done || cur ? "text-gray-900 dark:text-gray-100" : "text-gray-400"
                } ${cur ? "font-semibold" : ""}`}
              >
                <span
                  className={`inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-semibold ${
                    done
                      ? "bg-emerald-700 text-white"
                      : cur
                        ? "text-emerald-700 ring-2 ring-emerald-700 dark:text-emerald-400 dark:ring-emerald-500"
                        : "text-gray-400 ring-1 ring-gray-300 dark:ring-gray-700"
                  }`}
                >
                  {done ? "✓" : k + 1}
                </span>
                {s.label}
                <span className="ml-auto text-[12px] font-normal text-gray-400">
                  {s.actor === "approver" ? ctx.approverName : s.actor ? owner?.name || "team" : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className={`${CARD} space-y-2.5 p-5`}>
        <h3 className="text-sm font-semibold">Activity</h3>
        {events.length === 0 ? (
          <p className="text-[13px] text-gray-400">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e, i) => (
              <li key={i} className="grid gap-x-2.5 text-[13px] sm:grid-cols-[96px_minmax(0,1fr)]">
                <span className="text-[12px] tabular-nums text-gray-400">{e.at}</span>
                <span className="text-gray-700 dark:text-gray-300">
                  <strong className="font-semibold">{e.actorName}</strong> {e.note}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
