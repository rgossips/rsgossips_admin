"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/components/role-context";
import { ButtonSpinner } from "@/components/spinner";
import {
  STAGE_LABEL,
  STAGE_STYLE,
  fulfilmentState,
  type FulfilmentRow,
  type ShippingMode,
} from "@/lib/barter-fulfilment";
import { setShippingAddress, setShippingTracking } from "./fulfilment-actions";

// The delivery half of a barter application: where it goes, whether it has
// shipped, and whether the creator has said it arrived. Shown only when the
// campaign actually moves a product.
//
// State is derived from the row on render (see lib/barter-fulfilment.ts) —
// nothing here is stored or scheduled, so an overdue delivery surfaces the
// moment somebody looks, with no background job keeping it current.

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function FulfilmentPanel({
  application,
  shippingMode,
}: {
  application: FulfilmentRow & {
    id: string;
    shipping_carrier?: string | null;
    shipping_tracking_added_at?: string | null;
    product_feedback?: string | null;
    shipping_address_updated_at?: string | null;
  };
  shippingMode: ShippingMode;
}) {
  const router = useRouter();
  const { isViewer } = useRole();
  const s = fulfilmentState(application, shippingMode);

  const [editingAddress, setEditingAddress] = useState(false);
  const [address, setAddress] = useState(application.shipping_address || "");
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [tracking, setTracking] = useState(application.shipping_tracking_url || "");
  const [carrier, setCarrier] = useState(application.shipping_carrier || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  if (s.stage === "not_applicable") return null;

  const saveAddress = async () => {
    setBusy(true);
    setError("");
    setNote("");
    const res = await setShippingAddress(application.id, address);
    setBusy(false);
    if (res.error) return setError(res.error);
    setEditingAddress(false);
    setNote("Address saved.");
    router.refresh();
  };

  const saveTracking = async () => {
    setBusy(true);
    setError("");
    setNote("");
    const res = await setShippingTracking(application.id, tracking, carrier || undefined);
    setBusy(false);
    if (res.error) return setError(res.error);
    setTrackingOpen(false);
    setNote(res.notified ? "Tracking saved — the creator has been told." : "Tracking saved.");
    router.refresh();
  };

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Delivery</span>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_STYLE[s.stage]}`}>
          {STAGE_LABEL[s.stage]}
        </span>
        {shippingMode === "pickup" && (
          <span className="text-[11px] text-gray-500">Creator collects — pickup address is on the campaign</span>
        )}
        {s.receiptOverdue && (
          <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
            {s.daysOverdue === 0 ? "Due today, no word yet" : `${s.daysOverdue}d overdue, no word yet`}
          </span>
        )}
      </div>

      {/* Address — only for campaigns we ship */}
      {shippingMode === "yes" && (
        <div className="mt-2.5">
          {editingAddress ? (
            <div className="space-y-2">
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={4}
                maxLength={600}
                placeholder={"Name\nFlat / building / street\nArea, landmark\nCity, State PIN\nPhone"}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveAddress}
                  disabled={busy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
                >
                  {busy && <ButtonSpinner />}
                  Save address
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingAddress(false);
                    setAddress(application.shipping_address || "");
                    setError("");
                  }}
                  disabled={busy}
                  className="h-8 rounded-lg px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : application.shipping_address ? (
            <div className="flex items-start justify-between gap-3">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                {application.shipping_address}
              </p>
              {!isViewer && s.canEditAddress && (
                <button
                  type="button"
                  onClick={() => setEditingAddress(true)}
                  className="shrink-0 text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
                >
                  Edit
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-gray-500">
                No address yet.
                {s.addressRequested ? " We asked the creator by email and they haven't replied." : " The creator hasn't been asked for one."}
              </p>
              {!isViewer && (
                <button
                  type="button"
                  onClick={() => setEditingAddress(true)}
                  className="text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
                >
                  Add address
                </button>
              )}
            </div>
          )}
          {!s.canEditAddress && application.shipping_address && (
            <p className="mt-1 text-[11px] text-gray-400">Locked — it has already shipped.</p>
          )}
        </div>
      )}

      {/* Tracking */}
      <div className="mt-3 border-t border-gray-200 pt-2.5 dark:border-gray-800">
        {trackingOpen ? (
          <div className="space-y-2">
            <input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="https://… tracking link"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="Courier (optional) — Delhivery, BlueDart…"
              maxLength={60}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveTracking}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
              >
                {busy && <ButtonSpinner />}
                Save and notify creator
              </button>
              <button
                type="button"
                onClick={() => {
                  setTrackingOpen(false);
                  setError("");
                }}
                disabled={busy}
                className="h-8 rounded-lg px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : application.shipping_tracking_url ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <a
              href={application.shipping_tracking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Track delivery
            </a>
            {application.shipping_carrier && <span className="text-gray-500">via {application.shipping_carrier}</span>}
            <span className="text-gray-400">
              Shipped {fmtDate(application.shipping_tracking_added_at || null)} · expected {fmtDate(s.expectedAt)}
            </span>
            {!isViewer && (
              <button
                type="button"
                onClick={() => setTrackingOpen(true)}
                className="font-semibold text-gray-500 hover:underline cursor-pointer"
              >
                Change
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] text-gray-500">Not dispatched yet.</p>
            {!isViewer && s.canAddTracking && (
              <button
                type="button"
                onClick={() => setTrackingOpen(true)}
                className="text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
              >
                Add tracking
              </button>
            )}
            {!s.canAddTracking && (
              <span className="text-[12px] text-gray-400">Tracking can be added once the application is approved.</span>
            )}
          </div>
        )}
      </div>

      {/* What the creator said when it arrived */}
      {(application.product_received !== null || application.product_feedback) && (
        <div className="mt-3 border-t border-gray-200 pt-2.5 dark:border-gray-800">
          <p className="text-[12px] text-gray-600 dark:text-gray-300">
            {application.product_received === true
              ? `Creator confirmed delivery on ${fmtDate(application.product_received_at)}.`
              : application.product_received === false
                ? `Creator reported it did NOT arrive (${fmtDate(application.product_received_at)}).`
                : ""}
          </p>
          {application.product_feedback && (
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-2.5 text-[12px] italic text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              “{application.product_feedback}”
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
      {note && !error && <p className="mt-2 text-[12px] text-emerald-700 dark:text-emerald-400">{note}</p>}
    </div>
  );
}
