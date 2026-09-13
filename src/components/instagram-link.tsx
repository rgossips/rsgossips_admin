import { instagramProfileUrl, normalizeInstagramHandle } from "@/lib/instagram";

// "@handle" that opens the Instagram profile in a new tab. No hooks, so it
// renders from both server and client components. Falls back to plain text
// when the handle isn't a valid Instagram username. Never place it inside
// another <a>/<Link> — nested anchors are invalid HTML.
export function InstagramLink({
  handle,
  className = "",
  showAt = true,
}: {
  handle: string | null | undefined;
  className?: string;
  showAt?: boolean;
}) {
  const url = instagramProfileUrl(handle);
  const raw = (handle || "").trim();
  if (!raw) return <span className={className}>—</span>;
  const label = `${showAt ? "@" : ""}${normalizeInstagramHandle(raw) ?? raw.replace(/^@+/, "")}`;
  if (!url) return <span className={className}>{label}</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${label} on Instagram`}
      className={`inline-flex items-center gap-1 hover:text-pink-600 dark:hover:text-pink-400 hover:underline underline-offset-2 transition-colors ${className}`}
    >
      {label}
      <svg className="w-3 h-3 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}
