// What a user was holding when they did something.
//
// One owner for turning a raw user-agent into words an admin can act on,
// because "which platform was this?" is the first question on every support
// ticket and the answer decides who looks at it.
//
// Deliberately NOT the consumer app's parseDeviceName (rgossips_web
// src/utils/device-session.js). That one builds a label for the creator's
// own "trusted devices" list, where the only job is telling two of YOUR
// phones apart, and it has two blind spots this cannot afford:
//
//   1. Chrome on iOS reports "CriOS", never "Chrome". Its test is
//      `safari && !chrome`, so every Chrome-on-iOS session is labelled
//      Safari — 53 of the 695 sessions on record, including the one behind
//      the callback that prompted this.
//   2. It has no idea what the native app is, and no idea what an in-app
//      webview is. "Instagram" in the UA means the person opened us from a
//      link inside Instagram, in a webview with its own rules — exactly the
//      sort of place a button stops responding.
//
// Tested against all 184 distinct user agents on record.

export type Surface = "app" | "webview" | "browser" | "unknown";

export type DeviceInfo = {
  surface: Surface;
  /** "iOS", "Android", "Windows", "Mac", "Linux", or "" when unreadable. */
  os: string;
  /** OS version when the string carries one, else "". */
  osVersion: string;
  /** "Chrome", "Safari", "Instagram", "RGossips app", … or "". */
  client: string;
  /** One line for a table cell: "iPhone · Chrome". */
  label: string;
  /** "App" / "In-app" / "Web" — the badge beside the label. */
  surfaceLabel: string;
};

const UNKNOWN: DeviceInfo = {
  surface: "unknown",
  os: "",
  osVersion: "",
  client: "",
  label: "",
  surfaceLabel: "",
};

// The native app overrides navigator.userAgent with this, which is why one
// column can tell app from web with no extra plumbing: "RGossipsApp/ios-26.5".
const NATIVE_RE = /^RGossipsApp\/(ios|android)-([\d._]+)/i;

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = String(userAgent || "").trim();
  if (!ua) return UNKNOWN;

  const native = ua.match(NATIVE_RE);
  if (native) {
    const os = native[1].toLowerCase() === "ios" ? "iOS" : "Android";
    const osVersion = native[2];
    return {
      surface: "app",
      os,
      osVersion,
      client: "RGossips app",
      label: `${os} ${osVersion} · RGossips app`,
      surfaceLabel: "App",
    };
  }

  // ── OS ───────────────────────────────────────────────────────────────
  let os = "";
  let osVersion = "";
  if (/iPhone|iPod/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "Mac";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Linux|X11/i.test(ua)) os = "Linux";

  // iOS writes "iPhone OS 26_5_0"; Android writes "Android 10".
  const iosVer = ua.match(/(?:iPhone|CPU) OS (\d+(?:[._]\d+)*)/i);
  const droidVer = ua.match(/Android (\d+(?:\.\d+)*)/i);
  if (iosVer) osVersion = iosVer[1].replace(/_/g, ".");
  else if (droidVer) osVersion = droidVer[1];

  // ── Client ───────────────────────────────────────────────────────────
  //
  // Webviews first. They carry the host app's name ON TOP of a normal
  // browser UA, so testing for Chrome before Instagram would call an
  // Instagram webview "Chrome" and lose the thing that matters.
  let surface: Surface = "browser";
  let client = "";
  if (/Instagram/i.test(ua)) {
    client = "Instagram in-app";
    surface = "webview";
  } else if (/FBAN|FBAV|FB_IAB/i.test(ua)) {
    client = "Facebook in-app";
    surface = "webview";
  } else if (/\bLine\//i.test(ua) || /Snapchat/i.test(ua)) {
    client = /Snapchat/i.test(ua) ? "Snapchat in-app" : "LINE in-app";
    surface = "webview";
  } else if (/\bwv\b/i.test(ua)) {
    // Android's generic WebView marker. No host app name to show.
    client = "In-app browser";
    surface = "webview";
  } else if (/EdgiOS\//i.test(ua) || /\bEdg(e|A|iOS)?\//i.test(ua)) {
    client = "Edge";
  } else if (/CriOS\//i.test(ua)) {
    // Chrome on iOS. Says CriOS and Safari, never Chrome — the case the
    // consumer app's parser gets wrong.
    client = "Chrome";
  } else if (/FxiOS\//i.test(ua)) {
    client = "Firefox";
  } else if (/OPR\/|Opera/i.test(ua)) {
    client = "Opera";
  } else if (/SamsungBrowser\//i.test(ua)) {
    client = "Samsung Internet";
  } else if (/Firefox\//i.test(ua)) {
    client = "Firefox";
  } else if (/Chrome\//i.test(ua)) {
    client = "Chrome";
  } else if (/Safari\//i.test(ua)) {
    client = "Safari";
  }

  const label = [os, client].filter(Boolean).join(" · ");
  if (!label) return { ...UNKNOWN, surface: "unknown" };

  return {
    surface,
    os,
    osVersion,
    client,
    label,
    surfaceLabel: surface === "webview" ? "In-app" : "Web",
  };
}
