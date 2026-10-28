// The four ways scouting finds candidate creators on Instagram.
//
// SERVER ONLY (it calls hiker.ts, which reads the API key).
//
// THE FACT THAT SHAPES THIS WHOLE FEATURE: not one discovery endpoint
// returns a follower count. Verified against the live API, not assumed —
//
//   /v3/fbsearch/accounts?query=fashion blogger india  -> 20 users,  0 with follower_count
//   /v2/hashtag/medias/top?name=fashionbloggerindia    -> 22 users,  0 with follower_count
//   /v2/user/suggested/profiles?user_id=...            ->  9 users,  0 with follower_count
//   /v3/fbsearch/places?query=Mumbai                   -> 30 places, then medias -> users
//
// Each result carries username, pk, full_name, is_private, is_verified and a
// profile picture, and nothing else. So Nano/Micro/Macro — and every filter
// that depends on follower count — requires ONE PAID LOOKUP PER CANDIDATE
// (`/v1/user/by/id`, which the spec says is faster than by/username and we
// already hold the pk). There is no bulk endpoint; I checked the whole
// 167-endpoint spec.
//
// That is why searching and tiering are two separate steps in the UI with
// the cost stated between them, rather than one button that quietly spends
// a request per row.

import { hikerGet } from "./hiker";

export const SCOUT_MODES = ["hashtag", "keyword", "similar", "location"] as const;
export type ScoutMode = (typeof SCOUT_MODES)[number];

export type ScoutCandidate = {
  username: string;
  /** Instagram's numeric id. Lets the tiering call use by/id, the faster one. */
  pk: string | null;
  fullName: string | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  profilePicUrl: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Pull every distinct user object out of a response, whatever its shape.
 *
 * A walk rather than a path read, deliberately: the four endpoints nest
 * users completely differently (a hashtag page buries them under
 * `response.sections[].layout_content.medias[].media.user`, 1.36MB deep),
 * and those shapes are undocumented — the OpenAPI spec types these
 * responses as bare objects. A walk keeps working when one of them moves;
 * a hard-coded path silently returns nothing.
 */
function collectUsers(payload: any, cap = 60): ScoutCandidate[] {
  const out: ScoutCandidate[] = [];
  const seen = new Set<string>();
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== "object" || depth > 8 || out.length >= cap) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const username = typeof node.username === "string" ? node.username.trim().toLowerCase() : "";
    const hasId = node.pk != null || node.id != null;
    if (username && hasId && !seen.has(username)) {
      seen.add(username);
      out.push({
        username,
        pk: node.pk != null ? String(node.pk) : node.id != null ? String(node.id) : null,
        fullName: typeof node.full_name === "string" && node.full_name.trim() ? node.full_name.trim() : null,
        isPrivate: typeof node.is_private === "boolean" ? node.is_private : null,
        isVerified: typeof node.is_verified === "boolean" ? node.is_verified : null,
        profilePicUrl: typeof node.profile_pic_url === "string" ? node.profile_pic_url : null,
      });
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(payload, 0);
  return out;
}

export type DiscoverResult = {
  candidates: ScoutCandidate[];
  /** HikerAPI requests this call actually spent, for the UI's running total. */
  requestsSpent: number;
  error?: string;
  /** Context worth showing, e.g. which place was matched. */
  note?: string;
};

const clean = (s: string) => s.trim().replace(/^[#@]/, "");

/** Creators posting under a hashtag. One request. */
async function byHashtag(query: string): Promise<DiscoverResult> {
  const name = clean(query).replace(/[^A-Za-z0-9_]/g, "");
  if (!name) return { candidates: [], requestsSpent: 0, error: "Enter a hashtag." };
  const res = await hikerGet(`/v2/hashtag/medias/top`, { name });
  if (!res.ok) return { candidates: [], requestsSpent: 1, error: res.error };
  return { candidates: collectUsers(res.data), requestsSpent: 1, note: `#${name}` };
}

/** Instagram's own account search. One request. */
async function byKeyword(query: string): Promise<DiscoverResult> {
  const q = query.trim();
  if (!q) return { candidates: [], requestsSpent: 0, error: "Enter something to search for." };
  const res = await hikerGet(`/v3/fbsearch/accounts`, { query: q });
  if (!res.ok) return { candidates: [], requestsSpent: 1, error: res.error };
  return { candidates: collectUsers(res.data), requestsSpent: 1 };
}

/**
 * Instagram's own "similar accounts" for one creator. Needs the numeric id,
 * so a handle costs one extra lookup first — stated in the UI rather than
 * hidden, because it is the difference between 1 and 2 paid requests.
 */
async function bySimilar(query: string): Promise<DiscoverResult> {
  const handle = clean(query).toLowerCase();
  if (!handle) return { candidates: [], requestsSpent: 0, error: "Enter a creator's handle." };

  const lookup = await hikerGet<any>(`/v1/user/by/username`, { username: handle });
  if (!lookup.ok) return { candidates: [], requestsSpent: 1, error: lookup.error };
  const u = (lookup.data as any)?.user ?? lookup.data;
  const pk = u?.pk ?? u?.id;
  if (!pk) return { candidates: [], requestsSpent: 1, error: `Couldn't find @${handle} on Instagram.` };

  const res = await hikerGet(`/v2/user/suggested/profiles`, { user_id: String(pk) });
  if (!res.ok) return { candidates: [], requestsSpent: 2, error: res.error };
  // Instagram sometimes includes the seed account in its own suggestions.
  const candidates = collectUsers(res.data).filter((c) => c.username !== handle);
  return { candidates, requestsSpent: 2, note: `similar to @${handle}` };
}

/**
 * Creators posting from a place. Two requests before any candidate: places
 * search, then that place's top medias.
 *
 * Worth knowing when reading results: place tagging is optional and patchy,
 * so this finds people who TAGGED the location, not everyone who lives
 * there. For "who do we have in Mumbai" the creator database's own city
 * filter is the better tool — this is for finding people we do not have.
 */
async function byLocation(query: string): Promise<DiscoverResult> {
  const q = query.trim();
  if (!q) return { candidates: [], requestsSpent: 0, error: "Enter a place." };

  const places = await hikerGet<any>(`/v3/fbsearch/places`, { query: q });
  if (!places.ok) return { candidates: [], requestsSpent: 1, error: places.error };

  // Pick the first place carrying a usable numeric id.
  let pk: string | null = null;
  let name = "";
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== "object" || depth > 6 || pk) return;
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    const id = node.pk ?? node.location_id ?? node.external_id;
    const label = node.name ?? node.short_name;
    if (id != null && typeof label === "string" && !node.username && /^\d+$/.test(String(id))) {
      pk = String(id);
      name = label;
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(places.data, 0);
  if (!pk) return { candidates: [], requestsSpent: 1, error: `No Instagram place matched "${q}".` };

  const medias = await hikerGet(`/v1/location/medias/top/chunk`, { location_pk: pk });
  if (!medias.ok) return { candidates: [], requestsSpent: 2, error: medias.error };
  return { candidates: collectUsers(medias.data), requestsSpent: 2, note: name || q };
}

/** How many paid requests a search costs BEFORE any tiering. */
export function searchCost(mode: ScoutMode): number {
  return mode === "similar" || mode === "location" ? 2 : 1;
}

export async function discover(mode: ScoutMode, query: string): Promise<DiscoverResult> {
  switch (mode) {
    case "hashtag":
      return byHashtag(query);
    case "keyword":
      return byKeyword(query);
    case "similar":
      return bySimilar(query);
    case "location":
      return byLocation(query);
    default:
      return { candidates: [], requestsSpent: 0, error: "Unknown search type." };
  }
}
