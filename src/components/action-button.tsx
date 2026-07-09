"use client";

import { useFormStatus } from "react-dom";
import { ButtonSpinner } from "@/components/spinner";

interface ActionButtonProps {
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Submit button for a server-action `<form>`. Reads the form's pending
 * state via useFormStatus, so it shows a spinner and disables itself while
 * the action is in flight — giving click feedback and preventing double
 * submits. Use it in place of a raw `<button type="submit">` inside any
 * `<form action={serverAction}>`.
 */
export function ActionButton({ title, className, children }: ActionButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      title={title}
      disabled={pending}
      aria-busy={pending}
      className={`${className || ""} disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5`}
    >
      {pending ? <ButtonSpinner /> : children}
    </button>
  );
}
