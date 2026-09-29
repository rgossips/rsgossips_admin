// What the status page pings. Plain module — the page, the client component
// and the server action all read the same list.
//
// Nothing here runs on a timer: checks fire only when an admin presses
// Refresh. Several targets cost a real request (an edge-function cold start,
// a Razorpay API call), so an auto-poll would quietly spend quota and wake
// idle functions all day.

export type CheckGroup = "core" | "functions" | "sites" | "external" | "config";

export type CheckState = "ok" | "slow" | "down" | "skipped";

export type CheckResult = {
  id: string;
  label: string;
  group: CheckGroup;
  state: CheckState;
  /** Round trip in ms, absent when the check never ran. */
  ms?: number;
  /** HTTP status where there was one. */
  status?: number;
  /** One short line: the failure, or a useful fact on success. */
  detail?: string;
};

export const GROUP_LABEL: Record<CheckGroup, string> = {
  core: "Supabase",
  functions: "Edge functions",
  sites: "Websites",
  external: "Third parties",
  config: "Configuration",
};

export const GROUP_BLURB: Record<CheckGroup, string> = {
  core: "Database, auth and storage — everything else depends on these.",
  functions: "Pinged with a CORS preflight: proves the function is deployed and answering without running its work or spending quota.",
  sites: "The public creator/brand site and this portal.",
  external: "Services we pay for and call from the server.",
  config: "Whether a secret is present on this server. Values are never read or shown.",
};

/**
 * Edge functions worth knowing about — the ones whose failure is visible to a
 * creator or a brand within minutes. The project has ~70; pinging all of them
 * would be slow and pointless.
 */
export const PINGED_FUNCTIONS: { slug: string; label: string }[] = [
  { slug: "check-profile", label: "Profile lookup (every app open)" },
  { slug: "list-campaigns", label: "Campaign feed" },
  { slug: "list-brands", label: "Brand directory" },
  { slug: "apply-campaign", label: "Creator applies" },
  { slug: "update-application-status", label: "Application decisions" },
  { slug: "escrow-release", label: "Escrow release" },
  { slug: "refresh-instagram", label: "Instagram refresh" },
  { slug: "public-media-kit", label: "Public media kits" },
  { slug: "send-email", label: "Email sender" },
  { slug: "notifications", label: "Notifications" },
];

/** Secrets whose absence silently disables a feature. Presence only. */
export const CONFIG_KEYS: { key: string; label: string; needed: string }[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase URL", needed: "everything" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Service role key", needed: "every admin page" },
  { key: "NEXT_PUBLIC_SITE_URL", label: "Site URL", needed: "email links" },
  { key: "RAZORPAY_KEY_ID", label: "Razorpay key id", needed: "collected revenue" },
  { key: "RAZORPAY_KEY_SECRET", label: "Razorpay secret", needed: "collected revenue" },
  { key: "WIDGET_API_TOKEN", label: "Widget token", needed: "the desktop widget" },
  { key: "NUDGE_SECRET", label: "Nudge secret", needed: "creator nudges + unsubscribe links" },
  { key: "HIKER_API_KEY", label: "HikerAPI key", needed: "profile enrichment" },
];

/** Above this a check is reported as slow rather than healthy. */
export const SLOW_MS = 1500;

/** Every check is abandoned at this point so one dead host can't hang the page. */
export const TIMEOUT_MS = 8000;
