"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { sanitizeSearchTerm } from "@/lib/validation";
import { resolveHandles } from "@/lib/sourcing/resolve-handles";
import {
  MESSAGING_SCOPE,
  SYNC_BUDGET_MS,
  SYNC_THREAD_CAP,
  type ThreadFilter,
} from "@/lib/instagram-dm/constants";
import {
  counterparty,
  directionOf,
  fetchConversations,
  fetchMessage,
  fetchSelf,
  fetchThreadMessageIds,
  refreshLongLivedToken,
} from "@/lib/instagram-dm/graph";

// Instagram DM tracking: connecting an admin's account, reading their
// threads, and nothing else.
//
// NOTHING HERE SENDS A MESSAGE, and that is not a phase-one simplification
// — Meta has no endpoint that would let it. See the header of
// lib/instagram-dm/constants.ts.
//
// Every read is on demand. There is no cron and no poller: a sync costs real
// Graph API calls against a rate limit, and the portal's standing preference
// is that work happens when somebody asks for it (the System Status page
// takes the same line for the same reason).
//
// TABLES SHIP DARK. Until rgossips_web migration 090 is applied, every query
// here comes back PGRST205 ("relation does not exist"), which the page
// renders as a "not set up yet" state rather than an error — the same
// degradation the ai-usage page uses.

const MISSING_TABLE = "PGRST205";

export type IgAccount = {
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  tokenExpiresAt: string | null;
  /** True once a live call has PROVED the token can read messages. */
  canReadMessages: boolean;
  connectedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type IgThreadRow = {
  id: string;
  username: string | null;
  name: string | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  lastDirection: "in" | "out" | null;
  hasInbound: boolean;
  firstInboundAt: string | null;
  isArchived: boolean;
  messageCount: number;
  /** Who they are in our own database, matched on handle. Free. */
  creator: { influencerId: string | null; invitationId: string | null; name: string | null } | null;
};

export type IgMessageRow = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  sentAt: string | null;
  hasAttachment: boolean;
};

// ── Connection ──────────────────────────────────────────────────────────

/**
 * The signed-in admin's connected account, if any.
 */
export async function getInstagramAccount(): Promise<{
  error?: string;
  notLive?: true;
  account?: IgAccount | null;
}> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_instagram_accounts")
    .select("ig_user_id, username, name, profile_picture_url, token_expires_at, scopes, connected_at, last_synced_at, last_error")
    .eq("admin_id", actorId)
    .maybeSingle();
  if (error) {
    if (error.code === MISSING_TABLE) return { notLive: true };
    logError("igdm.account", error, { actorId });
    return { error: "Could not read your Instagram connection." };
  }
  if (!data) return { account: null };
  return {
    account: {
      igUserId: data.ig_user_id,
      username: data.username,
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
      tokenExpiresAt: data.token_expires_at,
      canReadMessages: Array.isArray(data.scopes) && data.scopes.includes(MESSAGING_SCOPE),
      connectedAt: data.connected_at,
      lastSyncedAt: data.last_synced_at,
      lastError: data.last_error,
    },
  };
}

/**
 * Store a token generated in the Meta App Dashboard, bypassing OAuth.
 *
 * WHY THIS EXISTS BESIDE THE OAUTH FLOW. The dashboard's
 * **Instagram → API setup with Instagram business login → Generate token**
 * button issues a LONG-LIVED (60-day) token for an account that has a role
 * on the app. For a handful of company-owned handles — which is exactly our
 * case — that is the shorter path, and it involves no `redirect_uri` at all,
 * so it does not depend on the OAuth redirect URIs being registered
 * correctly on the Meta app. It is also what makes the feature usable under
 * **Standard Access**, with no App Review.
 *
 * Everything downstream is identical: same table, same probe, same sync. The
 * only difference is where the token came from.
 */
export async function connectInstagramWithToken(
  token: string,
): Promise<{ error?: string; notLive?: true; username?: string; canReadMessages?: boolean; warning?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const clean = String(token || "").trim();
  if (clean.length < 20) return { error: "That does not look like an Instagram access token." };

  const rl = await enforceRateLimit({ action: "ig_dm_connect", actorId, limit: 12, windowSec: 60 * 60 });
  if (!rl.allowed) return { error: "Too many connection attempts. Try again later." };

  // Who does this token belong to? Asked of Instagram rather than typed by
  // the admin: the account identity has to come from the credential itself,
  // or a mistyped handle would file somebody else's inbox under their name.
  const self = await fetchSelf(clean);
  if (self.error || !self.data?.id) {
    return {
      error:
        `Instagram would not accept that token: ${self.error?.message || "no account came back"}. ` +
        `Generate a fresh one — a dashboard token is tied to one account and expires.`,
    };
  }

  // Same proof as the OAuth path: a token that cannot read messages is a
  // connection that will fail every sync, and saying so now beats saying it
  // after the first empty inbox.
  let canReadMessages = false;
  let warning: string | undefined;
  const probe = await fetchConversations(clean, 1);
  if (probe.error) {
    warning =
      `Connected, but this token cannot read messages: ${probe.error.message} ` +
      `Check that ${MESSAGING_SCOPE} is on the app's Instagram use case and that this account has a role on the app.`;
  } else {
    canReadMessages = true;
  }

  const admin = createAdminClient();
  const { error } = await admin.from("admin_instagram_accounts").upsert(
    {
      admin_id: actorId,
      ig_user_id: String(self.data.id),
      username: self.data.username || null,
      name: self.data.name || null,
      profile_picture_url: self.data.profile_picture_url || null,
      access_token: clean,
      // 60 days is what Meta documents for a dashboard-generated token. It
      // is an ASSUMPTION, not something the API told us — the generate-token
      // response carries no expiry — so the page's countdown is indicative
      // and `refresh_access_token` is the thing that makes it exact.
      token_expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      scopes: canReadMessages ? [MESSAGING_SCOPE] : [],
      connected_at: new Date().toISOString(),
      last_error: warning || null,
    },
    { onConflict: "admin_id" },
  );
  if (error) {
    if (error.code === MISSING_TABLE) return { notLive: true };
    if (String(error.code) === "23505") {
      return { error: "That Instagram account is already connected by another admin." };
    }
    logError("igdm.connectToken.save", error, { actorId });
    return { error: "Could not save the connection. Please try again." };
  }

  revalidatePath("/dashboard/instagram");
  return { username: self.data.username || undefined, canReadMessages, warning };
}

/**
 * Finish the OAuth handshake and store the connection.
 *
 * The code→token exchange goes through the consumer app's existing
 * `instagram-connect` edge function, which is STATELESS — it exchanges,
 * reads `/me`, and returns; it writes nothing. So this needs no new edge
 * function, no deploy, and no copy of INSTAGRAM_APP_SECRET in this app's
 * env. The scope set is decided at authorise time, not here, so the same
 * exchange serves a messaging token.
 */
export async function connectInstagramAccount(
  code: string,
  redirectUri: string,
): Promise<{ error?: string; notLive?: true; username?: string; canReadMessages?: boolean; warning?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  if (!code) return { error: "Instagram did not return an authorisation code." };

  // An authorisation code is single-use, so a retry loop is a dead end
  // anyway; the limit is here to stop the endpoint being hammered.
  const rl = await enforceRateLimit({
    action: "ig_dm_connect",
    actorId,
    limit: 12,
    windowSec: 60 * 60,
  });
  if (!rl.allowed) return { error: "Too many connection attempts. Try again later." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Supabase is not configured on this server." };

  let payload: {
    success?: boolean;
    error?: string;
    accessToken?: string;
    tokenExpiresAt?: string;
    userId?: string;
    profile?: { username?: string; name?: string; profilePictureUrl?: string; igUserId?: string };
  };
  try {
    const res = await fetch(`${url}/functions/v1/instagram-connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ code, redirectUri }),
      cache: "no-store",
    });
    payload = await res.json();
  } catch (e) {
    logError("igdm.connect.exchange", e, { actorId });
    return { error: "Could not reach Instagram to finish connecting. Please try again." };
  }
  if (payload.error || !payload.accessToken) {
    // The edge function already turns Instagram's unhelpful errors into
    // sentences aimed at the person reading them, so pass it through.
    return { error: payload.error || "Instagram did not return an access token." };
  }

  const token = payload.accessToken;
  const igUserId = String(payload.profile?.igUserId || payload.userId || "");
  if (!igUserId) return { error: "Instagram did not identify the account." };

  // Can this token actually read messages? PROVED, not assumed: the token
  // exchange says nothing about which scopes were granted, and a connection
  // that claims messaging it does not have fails every sync with no
  // explanation. One conversations call answers it.
  let canReadMessages = false;
  let warning: string | undefined;
  const probe = await fetchConversations(token, 1);
  if (probe.error) {
    warning =
      `Connected, but this account cannot read messages yet: ${probe.error.message} ` +
      `The Meta app needs the ${MESSAGING_SCOPE} permission enabled, and the Instagram account must be a ` +
      `Professional (Business or Creator) account added to the app in the Meta dashboard.`;
  } else {
    canReadMessages = true;
  }

  const admin = createAdminClient();
  const { error } = await admin.from("admin_instagram_accounts").upsert(
    {
      admin_id: actorId,
      ig_user_id: igUserId,
      username: payload.profile?.username || null,
      name: payload.profile?.name || null,
      profile_picture_url: payload.profile?.profilePictureUrl || null,
      access_token: token,
      token_expires_at: payload.tokenExpiresAt || null,
      scopes: canReadMessages ? [MESSAGING_SCOPE] : [],
      connected_at: new Date().toISOString(),
      last_error: warning || null,
    },
    { onConflict: "admin_id" },
  );
  if (error) {
    if (error.code === MISSING_TABLE) return { notLive: true };
    // 23505 on ig_user_id: this Instagram account is already connected by a
    // DIFFERENT admin. Worth saying plainly — two admins syncing one inbox
    // would each think it was theirs.
    if (String(error.code) === "23505") {
      return { error: "That Instagram account is already connected by another admin." };
    }
    logError("igdm.connect.save", error, { actorId });
    return { error: "Could not save the connection. Please try again." };
  }

  revalidatePath("/dashboard/instagram");
  return { username: payload.profile?.username || undefined, canReadMessages, warning };
}

/**
 * Forget the connection.
 *
 * The THREADS AND MESSAGES ARE KEPT. They are the only copy of history the
 * Instagram API will no longer serve (20 most recent per conversation), so
 * deleting them to tidy up would throw away the record permanently.
 * Reconnecting the same account picks them back up.
 */
export async function disconnectInstagramAccount(): Promise<{ error?: string; success?: boolean }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("admin_instagram_accounts").delete().eq("admin_id", actorId);
  if (error) {
    logError("igdm.disconnect", error, { actorId });
    return { error: "Could not disconnect. Please try again." };
  }
  revalidatePath("/dashboard/instagram");
  return { success: true };
}

// ── Sync ────────────────────────────────────────────────────────────────

export type SyncResult = {
  error?: string;
  notLive?: true;
  threads?: number;
  newMessages?: number;
  /** True when the time budget ran out before every thread was walked. */
  partial?: boolean;
  /** Threads whose detail Instagram refused — expected, not a failure. */
  unreadable?: number;
};

/**
 * Read the connected account's threads into our tables.
 *
 * On demand only. Costs one request for the thread list, one per thread for
 * its message ids, and one per message we have NOT seen before — so the
 * first run on a busy inbox is expensive and every run after it is cheap,
 * because the message id is the dedupe key.
 */
export async function syncInstagramMessages(): Promise<SyncResult> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const rl = await enforceRateLimit({
    action: "ig_dm_sync",
    actorId,
    limit: 60,
    windowSec: 60 * 60,
  });
  if (!rl.allowed) return { error: "You're syncing too often. Try again in a little while." };

  const admin = createAdminClient();
  const { data: acct, error: acctErr } = await admin
    .from("admin_instagram_accounts")
    .select("ig_user_id, access_token, token_expires_at, scopes")
    .eq("admin_id", actorId)
    .maybeSingle();
  if (acctErr) {
    if (acctErr.code === MISSING_TABLE) return { notLive: true };
    logError("igdm.sync.account", acctErr, { actorId });
    return { error: "Could not read your Instagram connection." };
  }
  if (!acct) return { error: "Connect your Instagram account first." };

  // An expired long-lived token cannot be refreshed — only a still-valid one
  // can — so this is a reconnect, not a retry.
  if (acct.token_expires_at && new Date(acct.token_expires_at).getTime() < Date.now()) {
    return { error: "Your Instagram connection has expired. Connect the account again." };
  }

  const deadline = Date.now() + SYNC_BUDGET_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_BUDGET_MS);
  const token = acct.access_token as string;
  const selfId = String(acct.ig_user_id);

  const finish = async (res: SyncResult, errText: string | null) => {
    clearTimeout(timer);
    await admin
      .from("admin_instagram_accounts")
      .update({ last_synced_at: new Date().toISOString(), last_error: errText })
      .eq("admin_id", actorId);
    revalidatePath("/dashboard/instagram");
    return res;
  };

  const convos = await fetchConversations(token, SYNC_THREAD_CAP, controller.signal);
  if (convos.error) {
    clearTimeout(timer);
    // Record it on the row: a connection that stopped working looks exactly
    // like an inbox with nothing new in it, and the page should not have to
    // guess which it is.
    await admin
      .from("admin_instagram_accounts")
      .update({ last_synced_at: new Date().toISOString(), last_error: convos.error.message })
      .eq("admin_id", actorId);
    revalidatePath("/dashboard/instagram");
    return { error: `Instagram refused the request: ${convos.error.message}` };
  }

  let newMessages = 0;
  let unreadable = 0;
  let walked = 0;
  let partial = false;

  for (const convo of convos.data || []) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    walked++;

    // The thread row has to exist before its messages can reference it, and
    // it is keyed on (admin_id, ig_thread_id) so a re-sync updates rather
    // than duplicates. ignoreDuplicates is NOT used: a re-sync must be able
    // to move last_message_at forward.
    const { data: threadRow, error: upErr } = await admin
      .from("admin_instagram_threads")
      .upsert(
        { admin_id: actorId, ig_thread_id: convo.id, updated_at: new Date().toISOString() },
        { onConflict: "admin_id,ig_thread_id" },
      )
      .select("id")
      .maybeSingle();
    if (upErr || !threadRow) {
      if (upErr?.code === MISSING_TABLE) return finish({ notLive: true }, null);
      logError("igdm.sync.thread", upErr, { actorId, convo: convo.id });
      continue;
    }
    const threadId = threadRow.id as string;

    const stubs = await fetchThreadMessageIds(token, convo.id, controller.signal);
    if (stubs.error) {
      unreadable++;
      continue;
    }

    // Only pay for what we do not already hold. This is what makes the
    // second and every later sync cheap.
    const { data: seen } = await admin
      .from("admin_instagram_messages")
      .select("mid")
      .eq("thread_id", threadId);
    const known = new Set((seen || []).map((r) => String(r.mid)));
    const wanted = (stubs.data || []).filter((s) => s.id && !known.has(String(s.id)));

    const rows: {
      thread_id: string;
      mid: string;
      direction: "in" | "out";
      body: string | null;
      attachments: unknown;
      sent_at: string | null;
    }[] = [];
    let party: { id?: string; username?: string; name?: string } | null = null;

    for (const stub of wanted) {
      if (Date.now() > deadline) {
        partial = true;
        break;
      }
      const msg = await fetchMessage(token, stub.id, controller.signal);
      if (msg.error || !msg.data) {
        // Expected: Instagram serves detail for only the 20 most recent
        // messages in a conversation and answers "deleted" past that. Not
        // an error to surface — the stub is simply unreadable.
        unreadable++;
        continue;
      }
      const direction = directionOf(msg.data, selfId);
      party = counterparty(msg.data, selfId) || party;
      rows.push({
        thread_id: threadId,
        mid: String(msg.data.id),
        direction,
        body: typeof msg.data.message === "string" && msg.data.message.trim() ? msg.data.message : null,
        attachments: msg.data.attachments ?? msg.data.shares ?? null,
        sent_at: msg.data.created_time ? new Date(msg.data.created_time).toISOString() : stub.created_time || null,
      });
    }

    if (rows.length > 0) {
      // Idempotent on (thread_id, mid): two admins' syncs, or a retry,
      // cannot write the same message twice.
      const { error: insErr } = await admin
        .from("admin_instagram_messages")
        .upsert(rows, { onConflict: "thread_id,mid", ignoreDuplicates: true });
      if (insErr) {
        logError("igdm.sync.messages", insErr, { actorId, threadId, count: rows.length });
      } else {
        newMessages += rows.length;
      }
    }

    // Recompute the thread's summary from the TABLE, not from this run's
    // rows: a sync that only saw the tail of a long thread must not report
    // its oldest visible message as the latest.
    const { data: newest } = await admin
      .from("admin_instagram_messages")
      .select("direction, body, sent_at")
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const { data: firstIn } = await admin
      .from("admin_instagram_messages")
      .select("sent_at")
      .eq("thread_id", threadId)
      .eq("direction", "in")
      .order("sent_at", { ascending: true, nullsFirst: false })
      .limit(1);
    const top = newest?.[0];
    const inbound = firstIn?.[0];

    await admin
      .from("admin_instagram_threads")
      .update({
        participant_igsid: party?.id || null,
        participant_username: party?.username || null,
        participant_name: party?.name || null,
        last_message_at: top?.sent_at || convo.updated_time || null,
        last_message_text: top ? (top.body ? String(top.body).slice(0, 280) : "[attachment]") : null,
        last_direction: top?.direction || null,
        has_inbound: Boolean(inbound),
        first_inbound_at: inbound?.sent_at || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", threadId);
  }

  return finish(
    { threads: walked, newMessages, partial, unreadable },
    // A run that found nothing is a SUCCESS, so the stored error is cleared.
    null,
  );
}

/**
 * Push the token's expiry out by another 60 days.
 *
 * Separate from the sync so a failure here cannot cost a read. Only works
 * while the token is still valid.
 */
export async function refreshInstagramToken(): Promise<{ error?: string; expiresAt?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("admin_instagram_accounts")
    .select("access_token")
    .eq("admin_id", actorId)
    .maybeSingle();
  if (!acct) return { error: "Connect your Instagram account first." };

  const res = await refreshLongLivedToken(acct.access_token as string);
  if (res.error || !res.data?.access_token) {
    return { error: res.error?.message || "Instagram would not extend the connection. Connect the account again." };
  }
  const expiresAt = new Date(Date.now() + (res.data.expires_in || 5_184_000) * 1000).toISOString();
  const { error } = await admin
    .from("admin_instagram_accounts")
    .update({ access_token: res.data.access_token, token_expires_at: expiresAt, last_error: null })
    .eq("admin_id", actorId);
  if (error) {
    logError("igdm.refresh.save", error, { actorId });
    return { error: "Extended the connection but could not save it. Please try again." };
  }
  revalidatePath("/dashboard/instagram");
  return { expiresAt };
}

// ── Reads ───────────────────────────────────────────────────────────────

/**
 * The connected account's threads, filtered.
 *
 * The creator match is done HERE rather than stored on the row: a handle
 * resolves differently over time — somebody invited today is registered next
 * month — and a column written at sync time would freeze the older answer.
 * It is free, because `resolveHandles` costs four queries whatever the page
 * size.
 */
export async function listInstagramThreads(opts?: {
  filter?: ThreadFilter;
  search?: string;
  limit?: number;
}): Promise<{ error?: string; notLive?: true; threads?: IgThreadRow[]; counts?: Record<ThreadFilter, number> }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }

  const admin = createAdminClient();
  const limit = Math.min(300, Math.max(1, Math.trunc(opts?.limit || 100)));
  const term = sanitizeSearchTerm(opts?.search || "");

  // Read the whole (capped) set once and derive every count from it, so a
  // tab cannot read 0 over a list with rows in it — the bug the campaign
  // applications tabs were built to avoid.
  let q = admin
    .from("admin_instagram_threads")
    .select("id, participant_username, participant_name, last_message_at, last_message_text, last_direction, has_inbound, first_inbound_at, is_archived")
    .eq("admin_id", actorId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (term) {
    q = q.or(`participant_username.ilike.%${term}%,participant_name.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) {
    if (error.code === MISSING_TABLE) return { notLive: true };
    logError("igdm.threads", error, { actorId });
    return { error: "Could not read your Instagram threads." };
  }

  const rows = data || [];
  const counts: Record<ThreadFilter, number> = {
    all: rows.filter((r) => !r.is_archived).length,
    replied: rows.filter((r) => !r.is_archived && r.has_inbound).length,
    awaiting: rows.filter((r) => !r.is_archived && r.last_direction === "in").length,
    unanswered: rows.filter((r) => !r.is_archived && !r.has_inbound).length,
    archived: rows.filter((r) => r.is_archived).length,
  };

  const filter: ThreadFilter = opts?.filter || "all";
  const picked = rows.filter((r) => {
    if (filter === "archived") return r.is_archived;
    if (r.is_archived) return false;
    if (filter === "replied") return r.has_inbound;
    if (filter === "awaiting") return r.last_direction === "in";
    if (filter === "unanswered") return !r.has_inbound;
    return true;
  });

  // Message counts, in one query rather than one per thread.
  const ids = picked.map((r) => r.id);
  const countByThread = new Map<string, number>();
  if (ids.length > 0) {
    const { data: msgs } = await admin.from("admin_instagram_messages").select("thread_id").in("thread_id", ids);
    for (const m of msgs || []) {
      const k = String(m.thread_id);
      countByThread.set(k, (countByThread.get(k) || 0) + 1);
    }
  }

  // Who they are to us. No campaign in play, hence the null.
  const handles = picked.map((r) => r.participant_username).filter(Boolean) as string[];
  const { resolved } = await resolveHandles(admin, null, handles);

  return {
    counts,
    threads: picked.map((r) => {
      const match = r.participant_username ? resolved?.get(String(r.participant_username).toLowerCase()) : undefined;
      return {
        id: r.id,
        username: r.participant_username,
        name: r.participant_name,
        lastMessageAt: r.last_message_at,
        lastMessageText: r.last_message_text,
        lastDirection: (r.last_direction as "in" | "out" | null) ?? null,
        hasInbound: r.has_inbound,
        firstInboundAt: r.first_inbound_at,
        isArchived: r.is_archived,
        messageCount: countByThread.get(String(r.id)) || 0,
        creator:
          match && match.kind !== "new"
            ? { influencerId: match.influencerId, invitationId: match.invitationId, name: match.knownName }
            : null,
      };
    }),
  };
}

/** One thread's messages, oldest first — the order a conversation reads in. */
export async function getInstagramThread(
  threadId: string,
): Promise<{ error?: string; messages?: IgMessageRow[] }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const admin = createAdminClient();
  // Scoped to the caller's own account: a thread id from another admin's
  // inbox must not open, even though both are admins. These are private
  // conversations held in a personal capacity.
  const { data: owned } = await admin
    .from("admin_instagram_threads")
    .select("id")
    .eq("id", threadId)
    .eq("admin_id", actorId)
    .maybeSingle();
  if (!owned) return { error: "That conversation is not on your connected account." };

  const { data, error } = await admin
    .from("admin_instagram_messages")
    .select("id, direction, body, attachments, sent_at")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) {
    logError("igdm.thread", error, { actorId, threadId });
    return { error: "Could not read that conversation." };
  }
  return {
    messages: (data || []).map((m) => ({
      id: m.id,
      direction: m.direction as "in" | "out",
      body: m.body,
      sentAt: m.sent_at,
      hasAttachment: Boolean(m.attachments),
    })),
  };
}

/** Mark a thread done, or put it back. */
export async function setInstagramThreadArchived(
  threadId: string,
  archived: boolean,
): Promise<{ error?: string; success?: boolean }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("admin_instagram_threads")
    .update({ is_archived: archived, updated_at: new Date().toISOString() })
    .eq("id", threadId)
    // Scoped to the caller, so a tampered id cannot archive somebody else's.
    .eq("admin_id", actorId);
  if (error) {
    logError("igdm.archive", error, { actorId, threadId });
    return { error: "Could not update that conversation." };
  }
  revalidatePath("/dashboard/instagram");
  return { success: true };
}

/** Confirm the stored token still identifies the account. */
export async function checkInstagramConnection(): Promise<{ error?: string; username?: string }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }
  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("admin_instagram_accounts")
    .select("access_token")
    .eq("admin_id", actorId)
    .maybeSingle();
  if (!acct) return { error: "Connect your Instagram account first." };
  const res = await fetchSelf(acct.access_token as string);
  if (res.error) return { error: res.error.message };
  return { username: res.data?.username };
}
