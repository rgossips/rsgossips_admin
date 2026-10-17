// Is this row a bug of OURS, or is it noise?
//
// The error log mixes four very different things and presents them
// identically, so a real defect sits in the same list as a creator who
// tapped Cancel on an App Store sheet. Over 285 live rows the split is
// roughly: a handful of genuine defects, a steady trickle of creator-side
// Instagram states that resolve themselves, guard refusals that are the
// product working, and browser noise. Only the first kind is worth being
// paged about.
//
// DERIVED, NOT STORED. The rules improve as we learn what the log actually
// contains, and a column written at insert time would freeze today's
// understanding into every historical row — the rows we most want to
// reclassify are the old ones. Recomputing is free: it is a regex over a
// string we already fetched.
//
// The bias is deliberate: anything this cannot confidently explain comes
// back `critical`. A false alarm costs a glance; a defect filed as noise is
// never looked at again.

export type ErrorClass = "critical" | "expected" | "external" | "transient";

export type TriageRow = {
  source?: string | null;
  area?: string | null;
  event?: string | null;
  message?: string | null;
  severity?: string | null;
  status_code?: number | null;
  context?: Record<string, unknown> | null;
  /** Where the throw came from. Often the ONLY place an extension names itself. */
  stack?: string | null;
};

// Something else injected into our page and threw in its own code. Mirrors
// INJECTED_GLOBAL in rgossips_web's ErrorReporter, which now drops these at
// source — kept here because 285 rows of history still carry them.
const INJECTED_GLOBAL =
  /\b(window\.)?(ethereum|solana|tronWeb|tronLink|evmAsk|__firefox__|__gCrWeb|__REACT_DEVTOOLS_GLOBAL_HOOK__)\b/;

// A WebView tearing down mid-navigation, an extension script, a browser
// refusing storage, or an aborted request. None of it is ours to fix.
//
// "Java exception was raised" matters as much as "Java object is gone" —
// the web reporter matches both and this did not, so two teardowns were
// filed as defects.
const EXTERNAL_MESSAGE =
  /Java (object is gone|exception was raised)|WKWebView was deallocated|^Script error\.?$|signal is aborted|The (user|operation) aborted|Failed to read the .localStorage. property/i;

// An extension that throws inside its OWN file names itself in the stack
// and nowhere else: 33 rows read "Cannot read properties of undefined
// (reading 'M_ID')" with a chrome-extension:// top frame. Matching the
// TOP frame only, so a real bug of ours that merely passes through an
// extension hook still counts as ours.
const EXTENSION_SCHEME = /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;
function fromExtension(stack: string | null | undefined): boolean {
  const s = String(stack || "");
  if (!EXTENSION_SCHEME.test(s)) return false;
  const firstFrame = s.split("\n").find((line) => /^\s*at\s|@/.test(line)) || "";
  return EXTENSION_SCHEME.test(firstFrame);
}

// The deploy moved under a browser holding the old manifest. Self-healing:
// the client reloads itself.
const STALE_CHUNK = /Failed to load chunk|ChunkLoadError|Loading chunk \d+ failed|error loading dynamically imported module/i;

// Platform, not us. "Project not specified." is Supabase's gateway refusing
// a request it could not route; it arrives with no stack.
const PLATFORM =
  /Project not specified|Failed to get project config|upstream connect error|Bad Gateway|503 Service|Gateway Timeout|fetch failed|Load failed|Failed to send a request to the Edge Function/i;
/**
 * A guard that refused something, logged at the call site.
 *
 * `apply-campaign.http_200` is the clearest case: HTTP 200 with a refusal
 * code in the body — subscription_required, gender_mismatch,
 * address_required. Those are the product enforcing its own rules, and the
 * creator was told why. Filing them as defects would bury the real ones.
 */
function isGuardRefusal(row: TriageRow): boolean {
  const event = String(row.event || "");
  if (/^apply-campaign\.http_200$/.test(event)) return true;
  const code = String((row.context as Record<string, unknown>)?.code || "");
  if (/subscription_required|gender_mismatch|address_required|already_applied|not_eligible/.test(code)) return true;
  // The App Store guard explaining why a plan cannot be changed on the web.
  if (/purchased through the App Store/i.test(String(row.message || ""))) return true;
  return false;
}

// Things the user did, or that the product correctly refused, and told
// them about. An expired OTP, a re-used Instagram authorization code and
// a sign-in blocked because the account is pending deletion are the
// system working as designed — all three were landing in the defect pile.
const USER_OUTCOME =
  /OTP expired|Invalid OTP|request a new (one|code)|authorization code has (been used|expired)|scheduled for deletion|Error validating access token/i;

/**
 * A creator-side state that resolves itself, already surfaced elsewhere.
 *
 * Instagram token and insights failures are badged on the influencer detail
 * page and clear on the next successful refresh; there is no code change
 * that would stop them. A purchase the user cancelled is not a failure.
 */
function isExpectedState(row: TriageRow): boolean {
  const event = String(row.event || "");
  if (USER_OUTCOME.test(String(row.message || ""))) return true;
  if (/^instagram\.refresh\./.test(event)) return true;
  const ctx = (row.context || {}) as Record<string, unknown>;
  if (event === "iap.purchase_failed" && (ctx.cancelled === true || /cancel/i.test(String(ctx.code || "")))) {
    return true;
  }
  // A media kit requested for a handle that does not exist is a correct 404.
  if (/^public-media-kit\.http_404$/.test(event) && /not found/i.test(String((ctx as { responseBody?: string }).responseBody || row.message || ""))) {
    return true;
  }
  return false;
}

/**
 * Classify one row.
 *
 * Order matters: external and expected are checked before anything else,
 * because an extension's TypeError and a guard's refusal both LOOK like
 * application errors if you only read the severity.
 */
export function classifyError(row: TriageRow): ErrorClass {
  const message = String(row.message || "");

  if (fromExtension(row.stack)) return "external";
  if (INJECTED_GLOBAL.test(message) || EXTERNAL_MESSAGE.test(message)) return "external";
  if (isExpectedState(row)) return "expected";
  if (isGuardRefusal(row)) return "expected";
  if (STALE_CHUNK.test(message) || PLATFORM.test(message)) return "transient";
  // A gateway timeout from an edge call is the platform, not our logic.
  if (row.status_code === 502 || row.status_code === 503 || row.status_code === 504) return "transient";

  // Everything left that was logged AS an error is treated as ours. A `warn`
  // that reached here is something we chose to record but not to shout about.
  if (String(row.severity || "") === "error") return "critical";
  return "expected";
}

export const CLASS_LABEL: Record<ErrorClass, string> = {
  critical: "Our bug",
  expected: "By design",
  external: "Not our code",
  transient: "Transient",
};

export const CLASS_STYLE: Record<ErrorClass, string> = {
  critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  expected: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  external: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  transient: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};
