// Who is eligible for each creator nudge, computed from live data.
//
// Server-only (service-role client). The whole creator base is loaded and
// filtered in memory: the rules span five tables and a JSON-free but
// multi-condition "last active" signal that PostgREST can't express, and the
// base is small (hundreds). Everything is paged past PostgREST's 1000-row cap.
//
// Global rules on top of each nudge's own rule:
//   * suspended creators and creators who unsubscribed get nothing;
//   * nobody gets more than one nudge in NUDGE_COOLDOWN_HOURS.

import { createAdminClient } from "@/utils/supabase/admin";
import { instagramStatus, type IgStatus } from "@/lib/instagram-status";
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-plans";
import { FREE_APPLICATIONS, INSTAGRAM_NUDGE_REPEAT_DAYS, NUDGE_COOLDOWN_HOURS, NUDGE_KEYS, type NudgeKey } from "./constants";

type Admin = ReturnType<typeof createAdminClient>;

const DAY = 86_400_000;
const PAID = new Set<string>(SUBSCRIPTION_TIERS.map((t) => t.key));

export type NudgeVars = {
  firstName: string;
  activeCampaigns: number;
  newCampaigns7d: number;
  appsUsed: number;
  freeLeft: number;
  followers: number;
  igStatus: IgStatus;
  subscribed: boolean;
};

export type NudgeRecipient = {
  userId: string;
  name: string;
  handle: string | null;
  email: string | null;
  vars: NudgeVars;
};

type ProfileRow = {
  influencer_id: string;
  full_name: string | null;
  email: string | null;
  instagram_handle: string | null;
  username: string | null;
  subscription_plan: string | null;
  created_at: string;
  categories: string[] | null;
  bio: string | null;
  followers_count: number | null;
  status: string | null;
  instagram_access_token: string | null;
  instagram_token_expires_at: string | null;
  instagram_token_invalid_at: string | null;
  instagram_insights_denied_at: string | null;
};

type SendRow = { user_id: string; nudge_key: string; sent_at: string };

export type NudgeContext = {
  /** False until migration 074 is applied — nothing can be recorded, so nothing is sent. */
  live: boolean;
  now: number;
  profiles: ProfileRow[];
  authEmail: Map<string, string>;
  authPhone: Map<string, string>;
  lastActive: Map<string, number>;
  apps: Map<string, number>;
  sends: Map<string, SendRow[]>;
  optedOut: Set<string>;
  activeCampaigns: number;
  newCampaigns7d: number;
};

// Pages a select past the 1000-row cap. `build` must return a fresh query
// each call (a PostgREST builder can't be re-ranged after it has run).
async function pageAll<T>(
  build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> },
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { rows, error: error.message };
    rows.push(...((data || []) as T[]));
    if (!data || data.length < 1000) return { rows, error: null };
  }
}

async function authUsers(admin: Admin): Promise<{ email: Map<string, string>; phone: Map<string, string> }> {
  const email = new Map<string, string>();
  const phone = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) break;
    for (const u of data.users) {
      if (u.email) email.set(u.id, u.email);
      if (u.phone) phone.set(u.id, u.phone);
    }
    if (data.users.length < 1000) break;
  }
  return { email, phone };
}

export async function loadNudgeContext(): Promise<NudgeContext> {
  const admin = createAdminClient();
  const now = Date.now();

  const [profiles, sessions, applications, sends, optOuts, auth, active, fresh] = await Promise.all([
    pageAll<ProfileRow>(() =>
      admin
        .from("influencer_profiles")
        .select(
          "influencer_id, full_name, email, instagram_handle, username, subscription_plan, created_at, categories, bio, followers_count, status, instagram_access_token, instagram_token_expires_at, instagram_token_invalid_at, instagram_insights_denied_at",
        )
        .order("influencer_id"),
    ),
    pageAll<{ user_id: string; last_active_at: string | null }>(() =>
      admin.from("device_sessions").select("user_id, last_active_at").order("id"),
    ),
    pageAll<{ influencer_id: string }>(() => admin.from("campaign_applications").select("influencer_id").order("id")),
    pageAll<SendRow>(() => admin.from("creator_nudge_sends").select("user_id, nudge_key, sent_at").order("id")),
    pageAll<{ user_id: string }>(() => admin.from("creator_nudge_opt_outs").select("user_id").order("user_id")),
    authUsers(admin),
    admin.from("campaigns").select("campaign_id", { count: "exact", head: true }).eq("status", "active"),
    admin
      .from("campaigns")
      .select("campaign_id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("created_at", new Date(now - 7 * DAY).toISOString()),
  ]);

  if (profiles.error) throw new Error(`influencer_profiles: ${profiles.error}`);

  const lastActive = new Map<string, number>();
  for (const s of sessions.rows) {
    const t = s.last_active_at ? Date.parse(s.last_active_at) : NaN;
    if (Number.isFinite(t) && t > (lastActive.get(s.user_id) ?? 0)) lastActive.set(s.user_id, t);
  }

  const apps = new Map<string, number>();
  for (const a of applications.rows) apps.set(a.influencer_id, (apps.get(a.influencer_id) ?? 0) + 1);

  const sendMap = new Map<string, SendRow[]>();
  for (const s of sends.rows) {
    const list = sendMap.get(s.user_id) ?? [];
    list.push(s);
    sendMap.set(s.user_id, list);
  }

  return {
    live: !sends.error && !optOuts.error,
    now,
    profiles: profiles.rows,
    authEmail: auth.email,
    authPhone: auth.phone,
    lastActive,
    apps,
    sends: sendMap,
    optedOut: new Set(optOuts.rows.map((o) => o.user_id)),
    activeCampaigns: active.count ?? 0,
    newCampaigns7d: fresh.count ?? 0,
  };
}

// Latest send time of one nudge for a creator (ms), or null.
function lastSent(ctx: NudgeContext, userId: string, key: NudgeKey): number | null {
  let latest: number | null = null;
  for (const s of ctx.sends.get(userId) ?? []) {
    if (s.nudge_key !== key) continue;
    const t = Date.parse(s.sent_at);
    if (latest === null || t > latest) latest = t;
  }
  return latest;
}

function inCooldown(ctx: NudgeContext, userId: string): boolean {
  const cutoff = ctx.now - NUDGE_COOLDOWN_HOURS * 3_600_000;
  return (ctx.sends.get(userId) ?? []).some((s) => Date.parse(s.sent_at) > cutoff);
}

function eligible(key: NudgeKey, p: ProfileRow, ctx: NudgeContext): boolean {
  const id = p.influencer_id;
  const age = ctx.now - Date.parse(p.created_at);
  const unpaid = !PAID.has(p.subscription_plan || "");
  // Fall back to signup time for creators with no device session yet.
  const active = ctx.lastActive.get(id) ?? Date.parse(p.created_at);
  const idle = ctx.now - active;
  const sent = (k: NudgeKey) => lastSent(ctx, id, k);

  switch (key) {
    case "a1":
      return unpaid && age >= DAY && sent("a1") === null;
    case "a2": {
      const a1 = sent("a1");
      return unpaid && age >= 3 * DAY && a1 !== null && ctx.now - a1 >= 2 * DAY && sent("a2") === null;
    }
    case "a3": {
      const a2 = sent("a2");
      return unpaid && age >= 7 * DAY && a2 !== null && ctx.now - a2 >= 3 * DAY && sent("a3") === null;
    }
    case "b1": {
      // Once per quiet spell: a b1 sent after they were last active counts.
      const b1 = sent("b1");
      return idle >= 2 * DAY && (b1 === null || b1 < active);
    }
    case "b2": {
      const b1 = sent("b1");
      const b2 = sent("b2");
      return (
        idle >= 7 * DAY &&
        b1 !== null && b1 >= active && ctx.now - b1 >= 3 * DAY &&
        (b2 === null || b2 < active)
      );
    }
    case "c1":
      return unpaid && (ctx.apps.get(id) ?? 0) >= FREE_APPLICATIONS && sent("c1") === null;
    case "c2": {
      const noCategories = !Array.isArray(p.categories) || p.categories.length === 0;
      const noBio = !p.bio || !p.bio.trim();
      return age >= DAY && (noCategories || noBio) && sent("c2") === null;
    }
    case "c3": {
      const c3 = sent("c3");
      return instagramStatus(p) !== "authorized" && (c3 === null || ctx.now - c3 >= INSTAGRAM_NUDGE_REPEAT_DAYS * DAY);
    }
  }
}

function toRecipient(p: ProfileRow, ctx: NudgeContext): NudgeRecipient {
  const name = (p.full_name || "").trim() || p.instagram_handle || p.username || "there";
  const apps = ctx.apps.get(p.influencer_id) ?? 0;
  const email = (p.email || "").trim() || ctx.authEmail.get(p.influencer_id) || null;
  return {
    userId: p.influencer_id,
    name,
    handle: p.instagram_handle || p.username,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    vars: {
      firstName: name.split(/\s+/)[0],
      activeCampaigns: ctx.activeCampaigns,
      newCampaigns7d: ctx.newCampaigns7d,
      appsUsed: apps,
      freeLeft: Math.max(0, FREE_APPLICATIONS - apps),
      followers: p.followers_count ?? 0,
      igStatus: instagramStatus(p),
      subscribed: PAID.has(p.subscription_plan || ""),
    },
  };
}

/** Everyone eligible for `key` right now, after the global rules. */
export function segment(key: NudgeKey, ctx: NudgeContext): NudgeRecipient[] {
  return ctx.profiles
    .filter(
      (p) =>
        p.status !== "suspended" &&
        !ctx.optedOut.has(p.influencer_id) &&
        !inCooldown(ctx, p.influencer_id) &&
        eligible(key, p, ctx),
    )
    .map((p) => toRecipient(p, ctx));
}

// ── Direct send: one creator, any template, admin's choice ───────────────
// Bypasses the per-nudge rules and the 48h cap on purpose (an admin picked
// this person), but never the unsubscribe list or a suspension.

export type CreatorMatch = {
  userId: string;
  name: string;
  handle: string | null;
  // Shown to the admin in the direct-send search (admin-gated action).
  email: string | null;
  hasEmail: boolean;
  igStatus: IgStatus;
  subscribed: boolean;
  blocked: "opted_out" | "suspended" | null;
  lastNudge: { key: string; at: string } | null;
};

function lastNudge(ctx: NudgeContext, userId: string): CreatorMatch["lastNudge"] {
  let latest: SendRow | null = null;
  for (const s of ctx.sends.get(userId) ?? []) if (!latest || s.sent_at > latest.sent_at) latest = s;
  return latest ? { key: latest.nudge_key, at: latest.sent_at } : null;
}

function toMatch(p: ProfileRow, ctx: NudgeContext): CreatorMatch {
  const r = toRecipient(p, ctx);
  return {
    userId: r.userId,
    name: r.name,
    handle: r.handle,
    email: r.email,
    hasEmail: !!r.email,
    igStatus: r.vars.igStatus,
    subscribed: r.vars.subscribed,
    blocked: ctx.optedOut.has(p.influencer_id) ? "opted_out" : p.status === "suspended" ? "suspended" : null,
    lastNudge: lastNudge(ctx, p.influencer_id),
  };
}

/** Name / handle / email / phone (4+ digits) search over every creator. */
export function searchCreators(ctx: NudgeContext, query: string, limit = 8): CreatorMatch[] {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (q.length < 2) return [];
  const digits = q.replace(/[\s+\-().]/g, "");
  const phoneQuery = /^\d{4,}$/.test(digits) ? digits.replace(/^0+/, "") : null;
  const hits = ctx.profiles.filter((p) => {
    if (phoneQuery) return (ctx.authPhone.get(p.influencer_id) || "").replace(/\D/g, "").includes(phoneQuery);
    const email = (p.email || ctx.authEmail.get(p.influencer_id) || "").toLowerCase();
    return [p.full_name, p.instagram_handle, p.username].some((v) => (v || "").toLowerCase().includes(q)) || email.includes(q);
  });
  return hits.slice(0, limit).map((p) => toMatch(p, ctx));
}

/**
 * The recipient for a direct send. `blockedReason` is set when a send must be
 * refused (unsubscribed / suspended) — the recipient is still returned so the
 * admin can preview what they would have got.
 */
export function directRecipient(
  ctx: NudgeContext,
  userId: string,
): { recipient: NudgeRecipient; match: CreatorMatch; blockedReason: string | null } | null {
  const p = ctx.profiles.find((x) => x.influencer_id === userId);
  if (!p) return null;
  const match = toMatch(p, ctx);
  const blockedReason =
    match.blocked === "opted_out" ? "This creator unsubscribed from nudges." : match.blocked === "suspended" ? "This creator is suspended." : null;
  return { recipient: toRecipient(p, ctx), match, blockedReason };
}

export function allSegments(ctx: NudgeContext): Record<NudgeKey, NudgeRecipient[]> {
  return Object.fromEntries(NUDGE_KEYS.map((k) => [k, segment(k, ctx)])) as Record<NudgeKey, NudgeRecipient[]>;
}
