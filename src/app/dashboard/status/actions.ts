"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate } from "@/lib/require-super-admin";
import { getSiteUrl } from "@/lib/site-url";
import {
  CONFIG_KEYS,
  PINGED_FUNCTIONS,
  SLOW_MS,
  TIMEOUT_MS,
  type CheckResult,
} from "@/lib/status/targets";

// Ping every dependency, on demand only. No revalidate, no polling: an admin
// presses Refresh and we spend one round trip per target.
//
// Deliberately read-only. The function pings are CORS preflights, so no edge
// function runs its body, nothing is written, and no email or notification
// can escape. The Razorpay call asks for a single payment, the cheapest
// authenticated read the API offers.

const timed = async (fn: (signal: AbortSignal) => Promise<Omit<CheckResult, "id" | "label" | "group" | "ms">>) => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const out = await fn(controller.signal);
    return { ...out, ms: Date.now() - started };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      state: "down" as const,
      detail: aborted ? `No answer in ${TIMEOUT_MS / 1000}s` : e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
};

const rate = (ms: number, detail?: string): { state: "ok" | "slow"; detail?: string } => ({
  state: ms > SLOW_MS ? "slow" : "ok",
  detail,
});

async function checkDatabase(): Promise<CheckResult> {
  const r = await timed(async () => {
    const { count, error } = await createAdminClient()
      .from("influencer_profiles")
      .select("influencer_id", { count: "exact", head: true });
    if (error) return { state: "down" as const, detail: error.message };
    return { state: "ok" as const, detail: `${(count ?? 0).toLocaleString("en-IN")} creators` };
  });
  return { id: "db", label: "Database", group: "core", ...r, ...(r.state === "ok" ? rate(r.ms!, r.detail) : {}) };
}

async function checkAuth(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { id: "auth", label: "Auth", group: "core", state: "skipped", detail: "Supabase URL or key not set" };
  const r = await timed(async (signal) => {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal, cache: "no-store" });
    if (!res.ok) return { state: "down" as const, status: res.status, detail: `HTTP ${res.status}` };
    return { state: "ok" as const, status: res.status };
  });
  return { id: "auth", label: "Auth (sign-in)", group: "core", ...r, ...(r.state === "ok" ? rate(r.ms!) : {}) };
}

async function checkStorage(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { id: "storage", label: "Storage", group: "core", state: "skipped", detail: "Supabase URL not set" };
  const r = await timed(async () => {
    const { data, error } = await createAdminClient().storage.listBuckets();
    if (error) return { state: "down" as const, detail: error.message };
    return { state: "ok" as const, detail: `${data?.length ?? 0} buckets` };
  });
  return { id: "storage", label: "Storage (images)", group: "core", ...r, ...(r.state === "ok" ? rate(r.ms!, r.detail) : {}) };
}

async function checkFunction(slug: string, label: string): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { id: `fn-${slug}`, label, group: "functions", state: "skipped", detail: "Supabase URL not set" };
  const r = await timed(async (signal) => {
    // A preflight: the platform answers without invoking the function body.
    const res = await fetch(`${url}/functions/v1/${slug}`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "POST", Origin: "https://rgossipsadmin.netlify.app" },
      signal,
      cache: "no-store",
    });
    // 404 is the one that matters: the function is not deployed.
    if (res.status === 404) return { state: "down" as const, status: 404, detail: "Not deployed" };
    if (res.status >= 500) return { state: "down" as const, status: res.status, detail: `HTTP ${res.status}` };
    return { state: "ok" as const, status: res.status };
  });
  return { id: `fn-${slug}`, label: `${slug} · ${label}`, group: "functions", ...r, ...(r.state === "ok" ? rate(r.ms!) : {}) };
}

async function checkSite(id: string, label: string, url: string): Promise<CheckResult> {
  const r = await timed(async (signal) => {
    const res = await fetch(url, { method: "GET", signal, cache: "no-store", redirect: "follow" });
    if (res.status >= 500) return { state: "down" as const, status: res.status, detail: `HTTP ${res.status}` };
    if (res.status >= 400) return { state: "slow" as const, status: res.status, detail: `HTTP ${res.status}` };
    return { state: "ok" as const, status: res.status };
  });
  return { id, label, group: "sites", ...r, ...(r.state === "ok" ? rate(r.ms!) : {}) };
}

async function checkRazorpay(): Promise<CheckResult> {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) {
    return { id: "razorpay", label: "Razorpay", group: "external", state: "skipped", detail: "Keys not set on this server" };
  }
  const r = await timed(async (signal) => {
    const auth = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${auth}` },
      signal,
      cache: "no-store",
    });
    if (res.status === 401) return { state: "down" as const, status: 401, detail: "Keys rejected" };
    if (!res.ok) return { state: "down" as const, status: res.status, detail: `HTTP ${res.status}` };
    const mode = id.startsWith("rzp_live") ? "live mode" : "test mode";
    return { state: "ok" as const, status: res.status, detail: mode };
  });
  return { id: "razorpay", label: "Razorpay API", group: "external", ...r, ...(r.state === "ok" ? rate(r.ms!, r.detail) : {}) };
}

function checkConfig(): CheckResult[] {
  return CONFIG_KEYS.map(({ key, label, needed }) => {
    const present = !!process.env[key];
    return {
      id: `cfg-${key}`,
      label,
      group: "config" as const,
      // A missing secret is not an outage, but it does disable something.
      state: present ? ("ok" as const) : ("down" as const),
      detail: present ? "Set" : `Missing — ${needed} will not work`,
    };
  });
}

export type StatusReport = {
  error?: string;
  checkedAt?: string;
  results?: CheckResult[];
};

export async function runStatusChecks(): Promise<StatusReport> {
  const denied = await adminGate();
  if (denied) return denied;

  let adminUrl = "https://rgossipsadmin.netlify.app";
  try {
    adminUrl = await getSiteUrl();
  } catch {
    /* falls back to the deployed portal */
  }

  const results = await Promise.all([
    checkDatabase(),
    checkAuth(),
    checkStorage(),
    ...PINGED_FUNCTIONS.map((f) => checkFunction(f.slug, f.label)),
    checkSite("site-web", "rgossips.com (creators + brands)", "https://rgossips.com/"),
    checkSite("site-admin", "This admin portal", `${adminUrl.replace(/\/+$/, "")}/login`),
    checkRazorpay(),
  ]);

  return { checkedAt: new Date().toISOString(), results: [...results, ...checkConfig()] };
}
