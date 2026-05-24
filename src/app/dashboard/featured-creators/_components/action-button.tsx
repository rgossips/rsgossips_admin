"use client";

import { useFormStatus } from "react-dom";
import { ButtonSpinner } from "@/components/spinner";

interface ActionButtonProps {
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Submit button that shows a spinner while the parent <form>'s server
 * action is in flight. Replace the inner content with a loader and disable
 * the button to prevent double clicks.
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
