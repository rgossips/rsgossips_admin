"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import { holdsSeat, stageSpec } from "@/lib/sourcing/stages";
import { canAct, canDrop, dropNeedsReason, movesFrom, type ActorContext, type MoveId } from "@/lib/sourcing/outreach";
import { assignBooking, deleteBooking, moveBooking, type AssignableAdmin } from "./outreach-actions";

// The controls for one row of the pipeline.
//
// Each stage offers one or two named moves, and the form a move needs comes
// with it — a quote box for the quote, a channel picker for the outreach, a
// cash-or-barter choice for the settlement. There is no generic "set the
// stage" dropdown: that was how a booking could land on a money stage out
// of order, and it asked the admin to know the ladder rather than just
// answer the question in front of them.
//
// Everything is re-checked server-side against the stage on the ROW, so a
// stale tab cannot replay a move that already happened.

const BTN =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold cursor-pointer disabled:cursor-wait disabled:opacity-60";
const PRIMARY = `${BTN} bg-emerald-700 text-white hover:bg-emerald-800`;
const PLAIN = `${BTN} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800`;
const PICK_ON = `${BTN} border border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300`;
const FIELD =
  "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-950";

export type OutreachRow = {
  id: string;
  instagram_username: string;
  creator_name: string | null;
  stage: string;
  quoted_fee_paise: number | null;
  agreed_fee_paise: number | null;
  assigned_to: string | null;
  contacted_channel: string | null;
  product_cost_paise: number | null;
  influencer_id: string | null;
  /** They also applied through the portal, so that row holds the seat too. */
  hasApplication?: boolean;
};

export type OutreachContext = {
  campaignId: string;
  admins: AssignableAdmin[];
  actor: ActorContext;
  approverName: string;
};

const rupees = (paise: number | null | undefined) =>
  paise == null ? "" : `₹${Math.round(Number(paise) / 100).toLocaleString("en-IN")}`;

// Button copy lives here rather than in outreach.ts: that module is shared
// with the server, and labels are not.
const MOVE_LABEL: Record<MoveId, string> = {
  approveCreator: "Approve and start outreach",
  rejectCreator: "Not a fit",
  markReached: "Mark as reached out",
  submitQuote: "Send for approval",
  declined: "Creator declined",
  approveQuote: "Approve quote",
  negotiate: "Negotiate further",
  markReimbursed: "Product bought and reimbursed",
  submitContent: "Send content for review",
  approveContent: "Approve content",
  requestChanges: "Request changes",
  closeDeal: "Settle and close",
  reopen: "Reopen as shortlisted",
  dropCreator: "Decline",
};

const PRIMARY_MOVES = new Set<MoveId>([
  "approveCreator",
  "markReached",
  "submitQuote",
  "approveQuote",
  "markReimbursed",
  "submitContent",
  "approveContent",
  "closeDeal",
]);

// Moves that need a value before they can run. The rest fire on one click.
const NEEDS_FORM: MoveId[] = [
  "dropCreator",
  "approveCreator",
  "markReached",
  "submitQuote",
  "markReimbursed",
  "submitContent",
  "requestChanges",
  "closeDeal",
];

export function OutreachControl({ row, ctx }: { row: OutreachRow; ctx: OutreachContext }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [open, setOpen] = useState<MoveId | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [armedDelete, setArmedDelete] = useState(false);

  // busy covers the action; pending covers the refresh that follows it.
  // Without the second half the spinner stopped while the row still showed
  // stale data, which read as a failure — Supabase is in Mumbai and this
  // runs as a function elsewhere, so the gap is visible.
  const working = busy || pending;

  const spec = stageSpec(row.stage);
  const moves = movesFrom(row.stage);
  const mine = canAct(row, ctx.actor);
  const canDelete = !ctx.actor.isViewer && (ctx.actor.isSuperAdmin || ctx.actor.isApprover);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function run(move: MoveId, payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await moveBooking(ctx.campaignId, row.id, move, payload);
    setBusy(false);
    if (res.error) return setError(res.error);
    setOpen(null);
    setDraft({});
    startTransition(() => router.refresh());
  }

  function start(move: MoveId) {
    if (NEEDS_FORM.includes(move)) {
      setOpen(open === move ? null : move);
      setError("");
      return;
    }
    void run(move, {});
  }

  if (!mine) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-gray-400">
          {spec.actor ? `Waiting on ${spec.actor === "approver" ? ctx.approverName : "the owner"}.` : "—"}
        </p>
        {canDelete && <DeleteLink row={row} ctx={ctx} armed={armedDelete} setArmed={setArmedDelete} />}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {moves.map((m) => (
          <button
            key={m}
            type="button"
            disabled={working}
            onClick={() => start(m)}
            className={PRIMARY_MOVES.has(m) ? PRIMARY : PLAIN}
          >
            {working && open === m && <ButtonSpinner />}
            {MOVE_LABEL[m]}
          </button>
        ))}
      </div>

      {open === "approveCreator" && (
        <MoveForm
          hint={`Confirm or change the quote before outreach starts.${row.quoted_fee_paise ? ` Suggested ${rupees(row.quoted_fee_paise)}.` : ""}`}
          onSubmit={() => run("approveCreator", { quote: Number(draft.quote) || null })}
          working={working}
        >
          <input
            className={FIELD}
            inputMode="numeric"
            placeholder="Quote to offer (₹)"
            value={draft.quote || ""}
            onChange={set("quote")}
          />
        </MoveForm>
      )}

      {open === "markReached" && (
        <MoveForm
          hint="How did you reach out?"
          onSubmit={() => run("markReached", { channel: draft.channel })}
          working={working}
          disabled={!draft.channel}
        >
          <div className="flex gap-1.5">
            {["Email", "Instagram DM"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, channel: c }))}
                className={draft.channel === c ? PICK_ON : PLAIN}
              >
                {c}
              </button>
            ))}
          </div>
        </MoveForm>
      )}

      {open === "submitQuote" && (
        <MoveForm
          hint={`Goes to ${ctx.approverName} for sign-off, not straight onto the campaign.`}
          onSubmit={() => run("submitQuote", { quote: Number(draft.quote) })}
          working={working}
          disabled={!draft.quote}
        >
          <input
            className={FIELD}
            inputMode="numeric"
            placeholder="Quote the creator agreed to (₹)"
            value={draft.quote || ""}
            onChange={set("quote")}
          />
        </MoveForm>
      )}

      {open === "markReimbursed" && (
        <MoveForm
          hint="The creator buys the product; record what you paid them back."
          onSubmit={() => run("markReimbursed", { reimb: Number(draft.reimb) })}
          working={working}
          disabled={!draft.reimb}
        >
          <input
            className={FIELD}
            inputMode="numeric"
            placeholder="Amount reimbursed (₹)"
            value={draft.reimb || ""}
            onChange={set("reimb")}
          />
        </MoveForm>
      )}

      {open === "submitContent" && (
        <MoveForm
          hint={`Goes to ${ctx.approverName} to review.`}
          onSubmit={() => run("submitContent", { link: draft.link })}
          working={working}
          disabled={!draft.link?.trim()}
        >
          <input className={FIELD} placeholder="Drive folder or post link" value={draft.link || ""} onChange={set("link")} />
        </MoveForm>
      )}

      {open === "dropCreator" && (
        <MoveForm
          hint={
            holdsSeat(row.stage)
              ? row.hasApplication
                ? "This frees their outreach slot, but they also applied through the portal and that application still holds a seat."
                : "This frees up their slot on the campaign."
              : "They were not holding a slot, so nothing changes on the seat count."
          }
          onSubmit={() => run("dropCreator", { note: draft.note })}
          working={working}
          disabled={dropNeedsReason(row) && !draft.note?.trim()}
        >
          {row.product_cost_paise ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {rupees(row.product_cost_paise)} was already reimbursed to them — declining does not undo that.
            </p>
          ) : null}
          <input
            className={FIELD}
            placeholder={dropNeedsReason(row) ? "Why are they being declined?" : "Reason (optional)"}
            value={draft.note || ""}
            onChange={set("note")}
          />
        </MoveForm>
      )}

      {open === "requestChanges" && (
        <MoveForm
          hint="Say what should change — the owner only sees this note."
          onSubmit={() => run("requestChanges", { note: draft.note })}
          working={working}
          disabled={!draft.note?.trim()}
        >
          <input className={FIELD} placeholder="What should change?" value={draft.note || ""} onChange={set("note")} />
        </MoveForm>
      )}

      {open === "closeDeal" && (
        <MoveForm
          hint="How is this creator being settled?"
          onSubmit={() => run("closeDeal", { mode: draft.mode, barter: draft.barter })}
          working={working}
          disabled={!draft.mode || (draft.mode === "Barter" && !draft.barter?.trim())}
        >
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, mode: "Cash" }))}
              className={draft.mode === "Cash" ? PICK_ON : PLAIN}
            >
              Pay {rupees(row.agreed_fee_paise) || "the agreed fee"}
            </button>
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, mode: "Barter" }))}
              className={draft.mode === "Barter" ? PICK_ON : PLAIN}
            >
              Barter product
            </button>
          </div>
          {draft.mode === "Barter" && (
            <input
              className={FIELD}
              placeholder="Product sent instead of payment"
              value={draft.barter || ""}
              onChange={set("barter")}
            />
          )}
        </MoveForm>
      )}

      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
        {canDrop(row) && (
          <button
            type="button"
            disabled={working}
            onClick={() => start("dropCreator")}
            className="text-[11px] font-semibold text-gray-500 hover:text-rose-600 hover:underline dark:hover:text-rose-400 cursor-pointer"
          >
            Decline creator
          </button>
        )}
        {canDelete && <DeleteLink row={row} ctx={ctx} armed={armedDelete} setArmed={setArmedDelete} />}
      </div>
    </div>
  );
}

// Module scope, never nested — a component redefined each render remounts
// its children, and the inputs would lose focus on every keystroke.
function MoveForm({
  hint,
  children,
  onSubmit,
  working,
  disabled,
}: {
  hint: string;
  children: React.ReactNode;
  onSubmit: () => void;
  working: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-800 dark:bg-gray-900/40">
      <p className="text-[11px] text-gray-500">{hint}</p>
      {children}
      <button type="button" disabled={working || disabled} onClick={onSubmit} className={PRIMARY}>
        {working && <ButtonSpinner />}
        Save
      </button>
    </div>
  );
}

function DeleteLink({
  row,
  ctx,
  armed,
  setArmed,
}: {
  row: OutreachRow;
  ctx: OutreachContext;
  armed: boolean;
  setArmed: (v: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const working = busy || pending;

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="text-[10px] font-semibold text-gray-400 hover:text-rose-600 hover:underline dark:hover:text-rose-400 cursor-pointer"
      >
        Remove from tracker
      </button>
    );
  }
  return (
    <div className="space-y-1 rounded-lg border border-rose-200 p-2 dark:border-rose-900">
      <p className="text-[10px] leading-relaxed text-rose-800 dark:text-rose-300">
        Remove @{row.instagram_username} and their history? They stay in the creator database — this only takes them off
        this campaign&apos;s tracker.
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={working}
          onClick={async () => {
            setBusy(true);
            setError("");
            const res = await deleteBooking(ctx.campaignId, row.id);
            setBusy(false);
            if (res.error) return setError(res.error);
            startTransition(() => router.refresh());
          }}
          className={`${BTN} bg-rose-600 text-white hover:bg-rose-500`}
        >
          {working && <ButtonSpinner />}
          Remove
        </button>
        <button type="button" disabled={working} onClick={() => setArmed(false)} className={PLAIN}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

/** The assignee picker, for the Owner column. */
export function OwnerControl({ row, ctx }: { row: OutreachRow; ctx: OutreachContext }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const working = busy || pending;
  const owner = ctx.admins.find((a) => a.id === row.assigned_to);
  // A team member can hand their own row on; only a super_admin takes one
  // off somebody else, so a negotiation cannot be quietly reassigned
  // mid-conversation.
  const mayChange =
    !ctx.actor.isViewer && (ctx.actor.isSuperAdmin || !row.assigned_to || row.assigned_to === ctx.actor.actorId);

  if (!mayChange) {
    return <span className="text-[12px] text-gray-600 dark:text-gray-300">{owner?.name || "—"}</span>;
  }
  return (
    <div className="space-y-1">
      <select
        value={row.assigned_to || ""}
        disabled={working}
        onChange={async (e) => {
          if (!e.target.value) return;
          setBusy(true);
          setError("");
          const res = await assignBooking(ctx.campaignId, row.id, e.target.value);
          setBusy(false);
          if (res.error) return setError(res.error);
          startTransition(() => router.refresh());
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-1.5 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-950"
      >
        <option value="">Unassigned</option>
        {ctx.admins.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {error && <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
