"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import { FULFILMENT_MODES, FULFILMENT_MODE_LABEL, type FulfilmentMode } from "@/lib/sourcing/stages";
import { addBooking } from "./actions";
import { lookupHandle, type HandleLookup } from "./lookup-actions";

// Add one creator to a campaign's sourcing list.
//
// The handle is the only required field: an admin pasting a name off a DM
// should not be blocked for want of a follower count they can fill in later.
// Everything else is optional and editable afterwards.
//
// Saving also files the creator as an invited influencer, which the success
// line says out loud — that is the difference between this and the
// spreadsheet it replaces.

const input =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100";
const label = "block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1";

export function AddBookingButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const [form, setForm] = useState({
    instagramUsername: "",
    creatorName: "",
    email: "",
    phone: "",
    tier: "",
    followersCount: "",
    quotedFee: "",
    agreedFee: "",
    productCost: "",
    shippingAddress: "",
    notes: "",
  });
  // Which route this creator takes. Per booking: on one campaign some are
  // sent the product and others buy it.
  const [mode, setMode] = useState<FulfilmentMode>("reimburse");
  const [looking, setLooking] = useState(false);
  const [lookup, setLookup] = useState<HandleLookup | null>(null);

  // Fired by a button, never on change or blur: each call spends HikerAPI
  // credits, and a debounce would buy one for "d", then "de", then "dee".
  const fetchDetails = async () => {
    setLooking(true);
    setError("");
    setLookup(null);
    const res = await lookupHandle(form.instagramUsername);
    setLooking(false);
    if (res.error) return setError(res.error);
    const r = res.result!;
    setLookup(r);
    // Fill only what is still blank — never overwrite something the admin
    // has already typed, which they would have typed for a reason.
    setForm((f) => ({
      ...f,
      instagramUsername: r.handle,
      creatorName: f.creatorName || r.fetched?.fullName || r.knownName || "",
      followersCount: f.followersCount || (r.fetched?.followers != null ? String(r.fetched.followers) : ""),
    }));
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError("");
    setNote("");
    const res = await addBooking({
      campaignId,
      instagramUsername: form.instagramUsername,
      creatorName: form.creatorName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      tier: form.tier || undefined,
      shippingAddress: form.shippingAddress || undefined,
      followersCount: form.followersCount ? Number(form.followersCount) : null,
      quotedFee: form.quotedFee ? Number(form.quotedFee) : null,
      agreedFee: form.agreedFee ? Number(form.agreedFee) : null,
      productCost: form.productCost ? Number(form.productCost) : null,
      notes: form.notes || undefined,
      fulfilmentMode: mode,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setNote(
      res.creatorOutcome === "created"
        ? "Added, and invited to the platform as a new creator."
        : res.creatorOutcome === "registered"
          ? "Added, and linked to their existing RGossips account."
          : "Added, and linked to their existing invitation.",
    );
    setForm({ instagramUsername: "", creatorName: "", email: "", phone: "", tier: "", followersCount: "", quotedFee: "", agreedFee: "", productCost: "", shippingAddress: "", notes: "" });
    router.refresh();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-500 cursor-pointer"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add creator
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Add a creator</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-gray-500 hover:underline cursor-pointer">
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className={label}>Instagram handle *</label>
          <div className="flex gap-2">
            <input
              className={input}
              value={form.instagramUsername}
              onChange={(e) => {
                set("instagramUsername")(e);
                setLookup(null);
              }}
              placeholder="@handle or profile URL"
            />
            {form.instagramUsername.trim().length > 1 && (
              <button
                type="button"
                onClick={fetchDetails}
                disabled={looking}
                title="Look this handle up on Instagram"
                className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 cursor-pointer"
              >
                {looking ? <ButtonSpinner /> : (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Fetch
              </button>
            )}
          </div>

          {lookup && (
            <div className="mt-1.5 text-[11px]">
              {/* Whether we already know them matters as much as the
                  follower count — it decides whether this creates an
                  invitation or links to a record we already hold. */}
              {lookup.known === "registered" && (
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  Already an RGossips creator — details from their profile.
                </span>
              )}
              {lookup.known === "invited" && (
                <span className="font-semibold text-amber-700 dark:text-amber-400">Already invited — will link to that invitation.</span>
              )}
              {lookup.known === "new" && !lookup.error && (
                <span className="text-gray-500">New to us — adding them creates an invitation.</span>
              )}
              {lookup.source === "db" && (
                <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  from our records · no API credit used
                </span>
              )}
              {lookup.fetched && (
                <span className="ml-1 text-gray-500">
                  {[
                    lookup.fetched.followers != null ? `${lookup.fetched.followers.toLocaleString("en-IN")} followers` : null,
                    lookup.fetched.posts != null ? `${lookup.fetched.posts} posts` : null,
                    lookup.fetched.category,
                    lookup.fetched.verified ? "verified" : null,
                    lookup.fetched.isPrivate ? "private account" : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
              {lookup.error && <span className="ml-1 text-rose-600 dark:text-rose-400">{lookup.error}</span>}
            </div>
          )}
        </div>
        <div><label className={label}>Name</label><input className={input} value={form.creatorName} onChange={set("creatorName")} /></div>
        <div><label className={label}>Tier</label><input className={input} value={form.tier} onChange={set("tier")} placeholder="Nano / Micro / Macro" /></div>
        <div><label className={label}>Followers</label><input className={input} inputMode="numeric" value={form.followersCount} onChange={set("followersCount")} /></div>
        <div><label className={label}>Email</label><input className={input} value={form.email} onChange={set("email")} /></div>
        <div><label className={label}>Phone</label><input className={input} value={form.phone} onChange={set("phone")} /></div>
        {/* Rupees in, paise in the column — the action does the one conversion. */}
        <div><label className={label}>Quoted (₹)</label><input className={input} inputMode="numeric" value={form.quotedFee} onChange={set("quotedFee")} /></div>
        <div><label className={label}>Agreed (₹)</label><input className={input} inputMode="numeric" value={form.agreedFee} onChange={set("agreedFee")} /></div>
        <div><label className={label}>Product cost (₹)</label><input className={input} inputMode="numeric" value={form.productCost} onChange={set("productCost")} /></div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label}>How does the product reach them?</label>
          <div className="flex flex-wrap gap-2">
            {FULFILMENT_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold cursor-pointer ${
                  mode === m
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-gray-300 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
                }`}
              >
                {FULFILMENT_MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        <div className={`sm:col-span-2 lg:col-span-3 ${mode === "none" ? "hidden" : ""}`}>
          <label className={label}>{mode === "ship" ? "Delivery address" : "Shipping address"}</label>
          <textarea className={input} rows={2} value={form.shippingAddress} onChange={set("shippingAddress")} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label}>Notes</label>
          <textarea className={input} rows={2} value={form.notes} onChange={set("notes")} placeholder="e.g. cost should be 10k-15k" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !form.instagramUsername.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {busy && <ButtonSpinner />}
          Add to campaign
        </button>
        <p className="text-[11px] text-gray-400">They&apos;re also filed as an invited influencer.</p>
      </div>

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
      {note && !error && <p className="mt-2 text-[12px] text-emerald-700 dark:text-emerald-400">{note}</p>}
    </div>
  );
}
