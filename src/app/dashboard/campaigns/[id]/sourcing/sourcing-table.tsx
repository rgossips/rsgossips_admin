"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InstagramLink } from "@/components/instagram-link";
import { ButtonSpinner } from "@/components/spinner";
import { useRole } from "@/components/role-context";
import {
  FULFILMENT_MODE_LABEL,
  STAGE_LABEL,
  STAGE_STYLE,
  nextStages,
  toFulfilmentMode,
  type BookingStage,
} from "@/lib/sourcing/stages";
import { advanceBookingStage } from "./actions";

// One row per sourced creator. Cards on phones, table from lg up — same
// split as every other list in the portal.
//
// The only control is "move to the next stage", because that is the whole
// job: the stage machine decides what is reachable, so an admin cannot skip
// the receipt and land on a payout.

export type Booking = {
  id: string;
  instagram_username: string;
  creator_name: string | null;
  email: string | null;
  phone: string | null;
  shipping_address: string | null;
  tier: string | null;
  followers_count: number | null;
  stage: string;
  quoted_fee_paise: number | null;
  agreed_fee_paise: number | null;
  product_cost_paise: number | null;
  influencer_id: string | null;
  invitation_id: string | null;
  live_url: string | null;
  fulfilment_mode: string | null;
  shipping_tracking_url: string | null;
  created_at: string;
};

const rupees = (paise: number | null) =>
  paise == null ? "—" : `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export function SourcingTable({ bookings }: { bookings: Booking[] }) {
  const router = useRouter();
  const { isViewer } = useRole();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (bookings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-12 text-center dark:border-gray-700">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Nobody sourced yet</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-gray-500">
          Add a creator and they join this campaign&apos;s seat count — and the creator database, as an invited
          influencer.
        </p>
      </div>
    );
  }

  const move = async (id: string, to: BookingStage) => {
    setBusy(id);
    setError("");
    const res = await advanceBookingStage(id, to);
    setBusy(null);
    if (res.error) return setError(res.error);
    router.refresh();
  };

  const StageControl = ({ b }: { b: Booking }) => {
    const options = nextStages(b.stage as BookingStage, toFulfilmentMode(b.fulfilment_mode));
    if (isViewer || options.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {busy === b.id && <ButtonSpinner />}
        {options.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy === b.id}
            onClick={() => move(b.id, s)}
            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 cursor-pointer"
          >
            {STAGE_LABEL[s]}
          </button>
        ))}
      </div>
    );
  };

  const Identity = ({ b }: { b: Booking }) => (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{b.creator_name || "—"}</p>
      <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-gray-500">
        <InstagramLink handle={b.instagram_username} />
        {b.followers_count ? <span>{b.followers_count.toLocaleString("en-IN")} followers</span> : null}
        {b.tier && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-800">{b.tier}</span>}
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            toFulfilmentMode(b.fulfilment_mode) === "ship"
              ? "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
              : toFulfilmentMode(b.fulfilment_mode) === "none"
                ? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                : "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
          }`}
          title={FULFILMENT_MODE_LABEL[toFulfilmentMode(b.fulfilment_mode)]}
        >
          {toFulfilmentMode(b.fulfilment_mode) === "ship" ? "we ship" : toFulfilmentMode(b.fulfilment_mode) === "none" ? "no product" : "reimburse"}
        </span>
        {/* The claim trigger binds this when they sign up; until then the
            booking stands on the contact snapshot alone. */}
        {!b.influencer_id && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            not linked
          </span>
        )}
      </div>
    </div>
  );

  return (
    <>
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Phones */}
      <ul className="space-y-3 lg:hidden">
        {bookings.map((b) => (
          <li key={b.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <Identity b={b} />
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_STYLE[b.stage as BookingStage]}`}>
                {STAGE_LABEL[b.stage as BookingStage] || b.stage}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Agreed</dt>
                <dd className="text-[13px] text-gray-800 dark:text-gray-200">{rupees(b.agreed_fee_paise)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Product</dt>
                <dd className="text-[13px] text-gray-800 dark:text-gray-200">{rupees(b.product_cost_paise)}</dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
              <StageControl b={b} />
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white lg:block dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
                {["Creator", "Stage", "Quoted", "Agreed", "Product", "Contact", "Next"].map((h) => (
                  <th key={h} className="px-5 py-3.5 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30">
                  <td className="px-5 py-3.5"><Identity b={b} /></td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_STYLE[b.stage as BookingStage]}`}>
                      {STAGE_LABEL[b.stage as BookingStage] || b.stage}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-600 dark:text-gray-300">{rupees(b.quoted_fee_paise)}</td>
                  <td className="px-5 py-3.5 text-[13px] font-semibold text-gray-800 dark:text-gray-200">{rupees(b.agreed_fee_paise)}</td>
                  <td className="px-5 py-3.5 text-[13px] text-gray-600 dark:text-gray-300">{rupees(b.product_cost_paise)}</td>
                  <td className="px-5 py-3.5 text-[12px] text-gray-500">
                    <div className="truncate max-w-[180px]">{b.email || "—"}</div>
                    <div>{b.phone || ""}</div>
                  </td>
                  <td className="px-5 py-3.5"><StageControl b={b} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
