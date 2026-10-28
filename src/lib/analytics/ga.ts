// Google Analytics 4 — reading the property, server side.
//
// SERVER ONLY. It holds a service-account private key.
//
// WHY NOT @google-analytics/data. The official client pulls gRPC and
// google-auth-library behind it, which is a lot of bundle and cold-start for
// three report calls. The Data API is plain REST and a service-account token
// is a signed JWT exchanged for a bearer — about forty lines with node:crypto
// and no new dependency. If this ever needs realtime, funnels or the Admin
// API, revisit that trade.
//
// WHAT IT CAN AND CANNOT SEE. GA4 is instrumented on the CONSUMER WEB APP
// only (G-EHKNXSHNB3 in rgossips_web/src/app/layout.js). The React Native app
// carries @react-native-firebase/app and messaging but NOT analytics, so it
// reports nothing here. Measured against device_sessions when this was
// written: 94% of active users are web and 7% are the native app, so these
// numbers understate real actives by roughly that much. The page says so
// rather than presenting GA as the whole truth.

import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_URL = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TIMEOUT_MS = 15_000;

export type GaResult<T> = { ok: true; data: T } | { ok: false; error: string };

type ServiceAccount = { client_email: string; private_key: string };

/**
 * The credentials, from env.
 *
 * `GA_SERVICE_ACCOUNT_JSON` takes the whole downloaded key file — raw JSON or
 * base64, because a multi-line JSON blob is awkward in a Netlify env var and
 * base64 sidesteps it. The private key's newlines survive either way: a raw
 * value usually arrives with literal "\n" sequences, which are restored here.
 */
function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  let text = raw.trim();
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(text) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

export function gaPropertyId(): string | null {
  const id = (process.env.GA_PROPERTY_ID || "").trim();
  // The NUMERIC property id, not the G-XXXX measurement id — mixing them up
  // is the most likely setup mistake, so it is rejected loudly rather than
  // sent to Google to fail with something cryptic.
  return /^\d{6,}$/.test(id) ? id : null;
}

export type GaConfigState =
  | { configured: true }
  | { configured: false; reason: string };

export function gaConfigured(): GaConfigState {
  if (!process.env.GA_SERVICE_ACCOUNT_JSON) {
    return { configured: false, reason: "GA_SERVICE_ACCOUNT_JSON is not set." };
  }
  if (!readServiceAccount()) {
    return { configured: false, reason: "GA_SERVICE_ACCOUNT_JSON is not a readable service-account key." };
  }
  const raw = (process.env.GA_PROPERTY_ID || "").trim();
  if (!raw) return { configured: false, reason: "GA_PROPERTY_ID is not set." };
  if (!gaPropertyId()) {
    return {
      configured: false,
      reason: `GA_PROPERTY_ID should be the numeric property id (e.g. 412345678), not "${raw.slice(0, 16)}".`,
    };
  }
  return { configured: true };
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Access tokens last an hour. Cached in module scope so a page with three
// reports on it mints one token, not three.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<GaResult<string>> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, data: cachedToken.token };
  }
  const sa = readServiceAccount();
  if (!sa) return { ok: false, error: "Google service account is not configured." };

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  let assertion: string;
  try {
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), sa.private_key);
    assertion = `${header}.${claims}.${b64url(signature)}`;
  } catch {
    // Almost always a mangled private key — newlines lost in the env var.
    return { ok: false, error: "Could not sign with the service-account key; check its private_key formatting." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !json.access_token) {
      return { ok: false, error: json.error_description || `Google refused the credentials (${res.status}).` };
    }
    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return { ok: true, data: json.access_token };
  } catch {
    return { ok: false, error: "Could not reach Google to authenticate." };
  } finally {
    clearTimeout(timer);
  }
}

export type GaRow = { dims: string[]; metrics: number[] };
export type GaReport = { rows: GaRow[]; totals: number[] };

export type RunReportInput = {
  dimensions?: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  limit?: number;
  orderByMetric?: string;
  orderDesc?: boolean;
  /**
   * Ask GA for column totals.
   *
   * Off by default and worth knowing: without this the API returns NO
   * `totals` block at all, so `report.totals` is an empty array and every
   * index into it is undefined. Only request it where a total is actually
   * displayed, and only for ADDITIVE metrics — a total of `activeUsers`
   * across days is not the number of people, because GA dedupes within the
   * grain you asked for.
   */
  withTotals?: boolean;
};

export async function runReport(input: RunReportInput): Promise<GaResult<GaReport>> {
  const propertyId = gaPropertyId();
  if (!propertyId) return { ok: false, error: "GA_PROPERTY_ID is not a numeric property id." };

  const token = await getAccessToken();
  if (!token.ok) return token;

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
    metrics: input.metrics.map((name) => ({ name })),
    limit: input.limit ?? 100,
  };
  if (input.dimensions?.length) body.dimensions = input.dimensions.map((name) => ({ name }));
  if (input.withTotals) body.metricAggregations = ["TOTAL"];
  if (input.orderByMetric) {
    body.orderBys = [{ metric: { metricName: input.orderByMetric }, desc: input.orderDesc ?? true }];
  } else if (input.dimensions?.length) {
    body.orderBys = [{ dimension: { dimensionName: input.dimensions[0] } }];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DATA_URL}/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.data}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json()) as {
      rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
      totals?: { metricValues?: { value: string }[] }[];
      error?: { message?: string; status?: string };
    };
    if (!res.ok) {
      // 403 here almost always means the service account was never granted
      // access to the property — the step people forget.
      const hint =
        res.status === 403
          ? " Add the service account's email as a Viewer in GA → Admin → Property Access Management."
          : "";
      return { ok: false, error: `${json.error?.message || `Analytics returned ${res.status}.`}${hint}` };
    }
    const num = (v: string | undefined) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      ok: true,
      data: {
        rows: (json.rows || []).map((r) => ({
          dims: (r.dimensionValues || []).map((d) => d.value),
          metrics: (r.metricValues || []).map((m) => num(m.value)),
        })),
        totals: (json.totals?.[0]?.metricValues || []).map((m) => num(m.value)),
      },
    };
  } catch {
    return { ok: false, error: "Could not reach the Analytics Data API." };
  } finally {
    clearTimeout(timer);
  }
}
