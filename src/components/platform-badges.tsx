import { PLATFORM_LABEL, PLATFORM_TITLE, type Platform } from "@/lib/device-platforms";

// Which platforms a creator or brand signs in from.
//
// Server-safe: no hooks, no client bundle. Used in both the desktop tables
// and the mobile cards, since both need to show the same thing.
//
// Colour carries the meaning so a row can be read without stopping to parse
// the words — the native apps are the signal worth spotting (38 of 499
// users have ever opened one), so they get the saturated colours and web
// stays neutral.
const STYLE: Record<Platform, string> = {
  web: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  android: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  ios: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
};

export function PlatformBadges({
  platforms,
  emptyLabel = "—",
  className = "",
}: {
  platforms: Platform[] | undefined;
  /** Shown when there is no session at all, i.e. they have never signed in. */
  emptyLabel?: string;
  className?: string;
}) {
  if (!platforms || platforms.length === 0) {
    return <span className={`text-[11px] text-gray-400 ${className}`}>{emptyLabel}</span>;
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {platforms.map((p) => (
        <span
          key={p}
          title={PLATFORM_TITLE[p]}
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STYLE[p]}`}
        >
          {PLATFORM_LABEL[p]}
        </span>
      ))}
    </span>
  );
}
