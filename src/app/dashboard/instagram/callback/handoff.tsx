"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IG_CALLBACK_PATH } from "@/lib/instagram-dm/constants";
import { connectInstagramAccount } from "../actions";

/**
 * Trades the authorisation code for a stored connection.
 *
 * Client-side because the `redirect_uri` in the token exchange must match
 * the one sent to Instagram byte for byte, and only the browser knows which
 * origin the admin used — localhost:3001 while testing, the Netlify host in
 * production. Deriving it on the server would be right in one and wrong in
 * the other.
 *
 * Fires ONCE. An authorisation code is single-use: a second attempt gets
 * "This authorization code has been used", which would read as a failure
 * over a connection that actually succeeded. React Strict Mode runs effects
 * twice in development, so the guard is a ref, not a state flag — a state
 * update does not land before the second invocation.
 */
export function CallbackHandoff({ code }: { code: string }) {
  const fired = useRef(false);
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void (async () => {
      const res = await connectInstagramAccount(code, `${window.location.origin}${IG_CALLBACK_PATH}`);
      if (res.error) {
        setState("failed");
        setMessage(res.error);
        return;
      }
      setState("done");
      setUsername(res.username || null);
      // A connection that cannot read messages is not a failure — the
      // account IS linked — but it is useless until the permission is
      // granted, so it must not read as a clean success.
      setMessage(res.warning || null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      {state === "working" && (
        <>
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-200 border-t-indigo-600" />
          <p className="text-[13px] text-gray-500 dark:text-gray-400">Finishing the Instagram connection…</p>
        </>
      )}

      {state === "done" && (
        <>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {username ? `@${username} is connected` : "Instagram is connected"}
          </h1>
          {message ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-[13px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {message}
            </p>
          ) : (
            <p className="text-[13px] text-gray-500 dark:text-gray-400">
              Press <strong>Sync messages</strong> to pull your conversations in.
            </p>
          )}
        </>
      )}

      {state === "failed" && (
        <>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Instagram did not connect</h1>
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-[13px] leading-relaxed text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
            {message}
          </p>
        </>
      )}

      <Link
        href="/dashboard/instagram"
        className="inline-block rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-500"
      >
        Back to Instagram messages
      </Link>
    </div>
  );
}
