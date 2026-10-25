"use client";

import { useEffect, useState } from "react";
import { ButtonSpinner } from "@/components/spinner";

/**
 * The submit button for a plain GET filter form.
 *
 * Two things the bare `<button type="submit">` got wrong. It had no
 * `cursor-pointer`, so it did not read as clickable at all — the rest of
 * the portal sets it explicitly because Tailwind's preflight gives buttons
 * `cursor: default`. And it gave no feedback: a filter submit is a full
 * document navigation that currently takes 1–3 seconds on this portal
 * (measured), which is easily long enough for someone to conclude nothing
 * happened and press it again.
 *
 * `useFormStatus` does NOT work here. It reports the pending state of a
 * React form ACTION, and these are native GET forms whose submission the
 * browser owns end to end — React never sees it. So the pending state is
 * tracked locally off the form's own submit event.
 *
 * There is no reset, deliberately: the submit navigates, the document is
 * replaced, and the button remounts fresh. The one case where that is not
 * true is a Back into the bfcache, which restores the old DOM with the
 * spinner still running — hence the `pageshow` listener, which is the only
 * way that state gets cleared.
 */
export function FilterSubmit({
  label,
  pendingLabel,
  className = "",
}: {
  label: string;
  /** Shown while navigating. Defaults to the same label beside a spinner. */
  pendingLabel?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Fires on a normal load AND on a bfcache restore; `persisted` tells
    // them apart, but clearing unconditionally is correct either way.
    const onShow = () => setPending(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  return (
    <button
      type="submit"
      onClick={() => setPending(true)}
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      {pending && <ButtonSpinner />}
      {pending ? pendingLabel || label : label}
    </button>
  );
}
