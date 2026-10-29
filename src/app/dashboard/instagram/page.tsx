import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { getInstagramAccount } from "./actions";
import { InstagramInbox } from "./inbox";

export const dynamic = "force-dynamic";

// Instagram DM tracking.
//
// An admin connects their OWN Instagram professional account; we read their
// conversations so the portal can finally answer "has this creator replied?"
// — a question the outreach tracker has always asked and never been able to
// answer from anything but somebody's memory.
//
// Admin-gated rather than super-admin: every member of the outreach team
// needs their own inbox, and each one only ever sees their own threads (the
// actions scope every read to the caller's `admin_id`). These are private
// conversations held in a personal capacity, so one admin reading another's
// is not something being an admin should allow.

export default async function InstagramPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard");

  const { account, notLive, error } = await getInstagramAccount();

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Instagram messages</h1>
        <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
          Connect your own Instagram account to track creator replies here, beside the campaigns they are for.
        </p>
      </div>

      {/* Said once, at the top, because it is the first thing everyone asks
          and the answer is a hard platform limit rather than a backlog item. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 text-[12px] leading-relaxed text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
        <strong className="text-gray-900 dark:text-gray-100">What this can and cannot do.</strong> It reads your DM
        threads so replies show up in the portal. It cannot send a first message: Instagram only allows a business
        account to send <em>after</em> the other person has written to it, inside a 24-hour window. There is no
        cold-DM API at any access level, so first contact stays you pressing send in the Instagram app — the{" "}
        <strong>DM</strong> buttons on Find creators and Scouting open exactly that.
      </div>

      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
          {error}
        </p>
      )}

      {notLive ? (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-5 py-8 text-center dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Not switched on yet</p>
          <p className="mx-auto mt-1 max-w-lg text-[13px] leading-relaxed text-amber-800 dark:text-amber-300">
            The tables this needs do not exist yet. Apply <code className="font-mono">090_admin_instagram_dm.sql</code>{" "}
            in the RS_Gossips project, then reload this page. Nothing is lost by waiting — no messages are collected
            until it is applied.
          </p>
        </div>
      ) : (
        <InstagramInbox account={account ?? null} />
      )}
    </div>
  );
}
