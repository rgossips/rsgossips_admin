"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import {
  APPROVAL_LABEL,
  APPROVAL_TONE,
  OUTREACH_LABEL,
  OUTREACH_STATUSES,
  OUTREACH_TONE,
  canDecideApproval,
  canRecordOutcome,
  outreachSummary,
  type ActorContext,
  type ApprovalState,
  type OutreachStatus,
} from "@/lib/sourcing/outreach";
import {
  assignBooking,
  decideApproval,
  recordOutreachOutcome,
  type AssignableAdmin,
} from "./outreach-actions";

// The outreach workflow, split across two table cells.
//
//   OutreachControl -> the "Outreach" column: what state this row is in, who
//                      holds it, and what was said. Read-mostly.
//   OutreachAction  -> the "Action" column: the one control that moves it.
//
// They are two components rather than one spanning both cells because a
// table cell cannot span columns conditionally, and because the question
// each answers is different: one is "where is this", the other is "what do
// I do about it".
//
// Everything is re-checked server-side. The gating here only decides what to
// render — it is not the security boundary, which is the action's own gate.

const BTN =
  "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold cursor-pointer disabled:cursor-wait disabled:opacity-60";
const SELECT =
  "rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-950";
const FIELD =
  "w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-950";

export type OutreachRow = {
  id: string;
  instagram_username: string;
  // Read only as a fallback for the summary line: bookings that predate the
  // tracker have no outreach_status, so the stage is the only evidence of
  // how far they actually got.
  stage: string;
  agreed_fee_paise: number | null;
  assigned_to: string | null;
  outreach_owner: string | null;
  outreach_status: string | null;
  outreach_note: string | null;
  approval_state: string | null;
  approval_note: string | null;
};

/** The last thing anybody did to this booking, and who. */
export type LastAction = { note: string; actorName: string; at: string } | null;

export type OutreachContext = {
  campaignId: string;
  admins: AssignableAdmin[];
  currentAdminId: string;
  isSuperAdmin: boolean;
  /** Holds the approver flag, or is a super_admin standing in. */
  canApprove: boolean;
  isViewer: boolean;
};

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{children}</span>;
}

// The rule lives in lib/sourcing/outreach.ts and these only adapt the
// context to it. They had their own copies of the logic for one commit,
// which is how a UI ends up offering a button the server then refuses —
// and here the server-side copy is the one the actions actually enforce.
const actorOf = (ctx: OutreachContext): ActorContext => ({
  actorId: ctx.currentAdminId,
  isSuperAdmin: ctx.isSuperAdmin,
  isApprover: ctx.canApprove,
});

/** Can this actor move the outreach outcome on this row? */
function mayRecord(row: OutreachRow, ctx: OutreachContext): boolean {
  if (ctx.isViewer) return false;
  return canRecordOutcome(row, actorOf(ctx));
}

/** Can this actor sign off on the agreed price? */
function mayDecide(row: OutreachRow, ctx: OutreachContext): boolean {
  if (ctx.isViewer) return false;
  return canDecideApproval(row, actorOf(ctx));
}

// ── The "Outreach" column ────────────────────────────────────────────────

export function OutreachControl({
  row,
  ctx,
  lastAction,
}: {
  row: OutreachRow;
  ctx: OutreachContext;
  lastAction?: LastAction;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const owner = ctx.admins.find((a) => a.id === row.assigned_to);
  const negotiator = ctx.admins.find((a) => a.id === row.outreach_owner);
  const approval = row.approval_state as ApprovalState | null;
  const status = row.outreach_status as OutreachStatus | null;
  const finished = approval === "approved" || approval === "rejected" || status === "declined";

  async function reassign(id: string) {
    setBusy(true);
    setError("");
    const res = await assignBooking(ctx.campaignId, row.id, id);
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {status && <Badge tone={OUTREACH_TONE[status]}>{OUTREACH_LABEL[status]}</Badge>}
        {approval && <Badge tone={APPROVAL_TONE[approval]}>{APPROVAL_LABEL[approval]}</Badge>}
        {!status && !approval && <span className="text-[11px] text-gray-400">{outreachSummary(row)}</span>}
        {busy && <ButtonSpinner />}
      </div>

      <div className="text-[11px] text-gray-500">
        {owner ? (
          <>
            with <span className="font-semibold text-gray-700 dark:text-gray-300">{owner.name}</span>
            {approval === "pending" && negotiator && negotiator.id !== owner.id
              ? ` · negotiated by ${negotiator.name}`
              : ""}
          </>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">nobody assigned</span>
        )}
      </div>

      {/* Assign, or hand to someone else. A super_admin can always reassign
          so a row cannot stick when somebody is on leave mid-negotiation. */}
      {!ctx.isViewer && !finished && (!row.assigned_to || ctx.isSuperAdmin) && (
        <select
          className={SELECT}
          value={row.assigned_to || ""}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) void reassign(e.target.value);
          }}
        >
          <option value="">Assign to…</option>
          {ctx.admins.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.isApprover ? " (approver)" : ""}
            </option>
          ))}
        </select>
      )}

      {row.approval_note && (
        <p className="text-[10px] text-gray-500">
          <span className="font-semibold">Sign-off:</span> {row.approval_note}
        </p>
      )}
      {row.outreach_note && (
        <p className="text-[10px] text-gray-500">
          <span className="font-semibold">Outreach:</span> {row.outreach_note}
        </p>
      )}

      {/* Who moved this last, and when — and deliberately NOT what they did.
          The note restated things the row already shows: "Agreed Rs 7,500"
          duplicates the Agreed column and "sent for sign-off" duplicates the
          badge above. The actor and the timestamp are the only part of the
          event not already on screen, so that is the only part shown. The
          full note is still written to campaign_booking_events. */}
      {lastAction && (
        <p className="text-[10px] text-gray-400" title={lastAction.note}>
          updated by {lastAction.actorName} · {lastAction.at}
        </p>
      )}

      {error && <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

// ── The "Action" column ──────────────────────────────────────────────────

export function OutreachAction({ row, ctx }: { row: OutreachRow; ctx: OutreachContext }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<OutreachStatus | "">("");
  const [amount, setAmount] = useState(
    row.agreed_fee_paise ? String(Math.round(row.agreed_fee_paise / 100)) : "",
  );
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function run(fn: () => Promise<{ error?: string }>) {
    setBusy(true);
    setError("");
    const res = await fn();
    setBusy(false);
    if (res.error) return setError(res.error);
    setChoice("");
    setNote("");
    setRejecting(false);
    router.refresh();
  }

  const canDecide = mayDecide(row, ctx);
  const canRecord = mayRecord(row, ctx);

  // Waiting on a sign-off that is not this person's to give.
  if (row.approval_state === "pending" && !canDecide && !canRecord) {
    return (
      <p className="text-[11px] text-gray-400">
        {row.outreach_owner === ctx.currentAdminId && !ctx.isSuperAdmin
          ? "Someone else signs this off."
          : "Waiting for an approver."}
      </p>
    );
  }

  if (!canDecide && !canRecord) {
    return <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>;
  }

  // BOTH blocks can show at once, and for a super_admin on a settled row
  // they do: they can revise the decision AND correct the outcome behind
  // it. For everyone else only one is ever true, so nothing changes.
  return (
    <div className="space-y-2">
      {canDecide &&
        (!rejecting ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => decideApproval(ctx.campaignId, row.id, "approved"))}
              className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-500`}
            >
              {busy && <ButtonSpinner />}
              {row.approval_state === "approved" ? "Re-approve" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => decideApproval(ctx.campaignId, row.id, "renegotiate"))}
              className={`${BTN} border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200`}
            >
              Send back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(true)}
              className={`${BTN} border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300`}
            >
              Reject
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <input
              className={FIELD}
              placeholder="Why is the price rejected?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
            <div className="flex gap-1">
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => void run(() => decideApproval(ctx.campaignId, row.id, "rejected", note))}
                className={`${BTN} bg-rose-600 text-white hover:bg-rose-500`}
              >
                {busy && <ButtonSpinner />}
                Reject price
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejecting(false)}
                className={`${BTN} border border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300`}
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-gray-400">The negotiator needs to know why, so this one is required.</p>
          </div>
        ))}

      {canRecord && (
        <div className="space-y-1">
          {canDecide && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Correct the outcome</p>
          )}
          <select
            className={SELECT}
            value={choice}
            disabled={busy}
            onChange={(e) => setChoice(e.target.value as OutreachStatus | "")}
          >
            <option value="">Set outcome…</option>
            {OUTREACH_STATUSES.map((st) => (
              <option key={st} value={st}>
                {OUTREACH_LABEL[st]}
              </option>
            ))}
          </select>

          {choice === "agreed" && (
            <input
              className={FIELD}
              inputMode="numeric"
              placeholder="Amount (₹)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
          )}

          {choice && (
            <>
              {choice === "agreed" && (
                <p className="text-[10px] text-gray-400">Goes to an approver, not straight onto the campaign.</p>
              )}
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={busy || (choice === "agreed" && !amount.trim())}
                  onClick={() =>
                    void run(() =>
                      recordOutreachOutcome(
                        ctx.campaignId,
                        row.id,
                        choice,
                        choice === "agreed" ? Number(amount) : null,
                        note,
                      ),
                    )
                  }
                  className={`${BTN} bg-indigo-600 text-white hover:bg-indigo-500`}
                >
                  {busy && <ButtonSpinner />}
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setChoice("")}
                  className={`${BTN} border border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300`}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
