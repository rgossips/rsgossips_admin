// Reading an admin's Instagram DMs out of the Graph API.
//
// Thin on purpose: every function here is one documented call and its
// response shape, and nothing in it knows about our tables. The sync action
// owns the deciding; this owns the talking.
//
// The response shapes are typed loosely because Meta's are not stable across
// versions and a missing field must degrade to "we don't know" rather than
// throw — the same reason `lib/scouting/sources.ts` walks a response instead
// of reading a fixed path.

import { IG_GRAPH, MESSAGES_PER_THREAD } from "./constants";

export type GraphError = { message: string; code?: number; subcode?: number };

export type IgConversation = { id: string; updated_time?: string };

export type IgMessageStub = { id: string; created_time?: string };

export type IgParty = { id?: string; username?: string; name?: string };

export type IgMessage = {
  id: string;
  created_time?: string;
  from?: IgParty;
  /** Meta returns `to` as a wrapped array, not a bare object. */
  to?: { data?: IgParty[] };
  message?: string;
  attachments?: unknown;
  shares?: unknown;
};

/**
 * One GET against graph.instagram.com.
 *
 * Meta answers an application error with HTTP 400 AND an `error` object, so
 * both have to be inspected — checking `res.ok` alone turns "token expired"
 * into an unhelpful generic failure, which is the trap the consumer app's
 * `instagram-connect` documents at length.
 */
async function get<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  signal?: AbortSignal,
): Promise<{ data?: T; error?: GraphError }> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  let res: Response;
  try {
    res = await fetch(`${IG_GRAPH}/${path.replace(/^\/+/, "")}?${qs}`, {
      cache: "no-store",
      signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { error: { message: aborted ? "Instagram did not answer in time." : e instanceof Error ? e.message : String(e) } };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { error: { message: `Instagram returned a non-JSON response (HTTP ${res.status}).` } };
  }
  const obj = (body || {}) as Record<string, unknown>;
  if (obj.error) {
    const e = obj.error as Record<string, unknown>;
    return {
      error: {
        message: String(e.message || `HTTP ${res.status}`),
        code: typeof e.code === "number" ? e.code : undefined,
        subcode: typeof e.error_subcode === "number" ? e.error_subcode : undefined,
      },
    };
  }
  if (!res.ok) return { error: { message: `HTTP ${res.status}` } };
  return { data: body as T };
}

/** The connected account itself — used to confirm a token still works. */
export async function fetchSelf(
  token: string,
  signal?: AbortSignal,
): Promise<{ data?: { id: string; username?: string; name?: string; profile_picture_url?: string }; error?: GraphError }> {
  // A SHORT field list on purpose: a heavy one makes Instagram answer
  // "Unsupported request - method type: get" and hide the real error, which
  // is the behaviour instagram-connect's step 3 exists to work around.
  return get("me", { fields: "id,username,name,profile_picture_url" }, token, signal);
}

/**
 * The account's conversations, newest activity first.
 *
 * `platform=instagram` is required — the same endpoint serves Messenger for
 * a linked Page, and omitting it can return the wrong inbox entirely.
 *
 * Note what is NOT asked for: `participants`. That field is only returned
 * when Conversation Routing is enabled on the account, so the other party's
 * handle is read off a message's `from`/`to` instead, which is always there.
 */
export async function fetchConversations(
  token: string,
  limit: number,
  signal?: AbortSignal,
): Promise<{ data?: IgConversation[]; error?: GraphError }> {
  const res = await get<{ data?: IgConversation[] }>(
    "me/conversations",
    { platform: "instagram", fields: "id,updated_time", limit: String(limit) },
    token,
    signal,
  );
  if (res.error) return { error: res.error };
  return { data: res.data?.data || [] };
}

/**
 * The message ids in one conversation.
 *
 * Ids and timestamps only — the body of each has to be fetched separately,
 * and that is the expensive half, so the caller compares these ids against
 * what it already holds and only pays for the new ones.
 */
export async function fetchThreadMessageIds(
  token: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<{ data?: IgMessageStub[]; error?: GraphError }> {
  const res = await get<{ messages?: { data?: IgMessageStub[] } }>(
    conversationId,
    { fields: `messages.limit(${MESSAGES_PER_THREAD})` },
    token,
    signal,
  );
  if (res.error) return { error: res.error };
  return { data: res.data?.messages?.data || [] };
}

/**
 * One message, with sender, recipient and text.
 *
 * `from`/`to` carry both the Instagram-scoped id and the username, which is
 * what lets a thread be matched to a creator in our own database for free.
 *
 * Expect failures here and treat them as ordinary: Meta serves details for
 * only the 20 most recent messages in a conversation and answers "deleted"
 * for anything older, so a sync that walks a long thread WILL hit it.
 */
export async function fetchMessage(
  token: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<{ data?: IgMessage; error?: GraphError }> {
  return get<IgMessage>(
    messageId,
    { fields: "id,created_time,from,to,message,attachments,shares" },
    token,
    signal,
  );
}

/**
 * Extend a long-lived token for another 60 days.
 *
 * Only works while the token is STILL VALID — an expired one cannot be
 * refreshed and the admin has to reconnect, which is why the page reads
 * `token_expires_at` on every load rather than waiting for a failure.
 */
export async function refreshLongLivedToken(
  token: string,
  signal?: AbortSignal,
): Promise<{ data?: { access_token: string; expires_in?: number }; error?: GraphError }> {
  return get<{ access_token: string; expires_in?: number }>(
    "refresh_access_token",
    { grant_type: "ig_refresh_token" },
    token,
    signal,
  );
}

/** Which way a message went, from the point of view of the connected account. */
export function directionOf(msg: IgMessage, selfIgId: string): "in" | "out" {
  return String(msg.from?.id || "") === String(selfIgId) ? "out" : "in";
}

/**
 * The other party on a message.
 *
 * For an inbound message that is `from`; for one we sent it is the first
 * entry of `to`. Group threads are not a case we handle — Instagram DMs to
 * creators are one-to-one — so the first recipient is the party.
 */
export function counterparty(msg: IgMessage, selfIgId: string): IgParty | null {
  const out = String(msg.from?.id || "") === String(selfIgId);
  if (!out) return msg.from || null;
  return msg.to?.data?.[0] || null;
}
