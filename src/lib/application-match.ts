// How closely an applicant fits the brief they applied to.
//
// Applications arrive newest-first, which tells a brand nothing about who is
// worth reading. This scores each applicant against the campaign's own
// targeting so the best fits come first, and says WHY on every row — a
// ranking a brand cannot interrogate is one they will not trust.
//
// This is NOT lib/sourcing/pool.ts, and the difference is the whole point.
// pool.ts ranks the people we might approach: it awards points for a match
// and nothing otherwise, which is fine for discovery because a creator with
// no categories on file is genuinely a weaker lead. Here the creator has
// already applied, and ranking them last because their PROFILE is thin
// rather than because they are a poor fit would be wrong — the brand acts
// on this order.
//
// Measured against the live table (500 profiles): followers_count and
// engagement_rate are 100% filled, gender 51%, location 14%, categories
// 12%. So "missing" is the common case, not the edge case, and a scorer
// that cannot tell "does not match" from "we do not know" would be ranking
// on data completeness. Hence three outcomes per dimension:
//
//   match    — full weight
//   miss     — zero
//   unknown  — HALF weight, and said out loud on the row
//
// The score is then a percentage of what was actually achievable for that
// brief, so a campaign that specifies only a follower range produces
// comparable numbers to one that specifies everything.
//
// Hand-synced with rgossips_web/src/lib/applicationMatch.js, which the brand
// app uses for the same ordering. Mirror any change there, the same way
// gender-target.ts mirrors _shared/gender-match.ts.

import { requiredGender, genderLabel } from "@/lib/gender-target";

export type MatchTarget = {
  categories?: string[] | null;
  cities?: string[] | null;
  followerMin?: number | null;
  followerMax?: number | null;
  /** The campaign's target_gender array, straight off the description trailer. */
  gender?: string[] | null;
  /** min_engagement_rate from the trailer, as a percentage. */
  minEngagementRate?: number | null;
};

export type MatchCreator = {
  followersCount?: number | null;
  categories?: string[] | null;
  location?: string | null;
  engagementRate?: number | null;
  gender?: string | null;
};

export type Verdict = "match" | "miss" | "unknown";

export type MatchDimension = {
  key: "followers" | "categories" | "gender" | "location" | "engagement";
  label: string;
  verdict: Verdict;
};

export type MatchResult = {
  /** 0-100, or null when the brief specifies nothing to match against. */
  percent: number | null;
  dimensions: MatchDimension[];
  /** Known to be under the brief's follower minimum. Never true when unknown. */
  belowFollowerMin: boolean;
  /** Known to be the gender the brief excludes. */
  genderMismatch: boolean;
};

// Followers lead because it is the one thing every brief states and every
// profile has. Engagement is a tie-breaker, not a qualifier.
const WEIGHTS = {
  followers: 35,
  categories: 30,
  gender: 15,
  location: 12,
  engagement: 8,
} as const;

// A near miss still earns most of the weight: a creator at 11k on a 1-10k
// brief is someone a brand would want to see, not someone to bury.
const NEAR_CREDIT = 0.6;
// How far outside the band still counts as near, as a fraction of the edge.
const NEAR_DRIFT = 0.5;

const norm = (s: unknown) => String(s || "").trim().toLowerCase();

// "All India" is the brief saying "anywhere"; as a city name it matches nobody.
const WILDCARD_CITIES = new Set(["all india", "all", "anywhere", "pan india", "any"]);

export function scoreApplicant(creator: MatchCreator, target: MatchTarget): MatchResult {
  const dimensions: MatchDimension[] = [];
  let earned = 0;
  let achievable = 0;
  let belowFollowerMin = false;
  let genderMismatch = false;

  const add = (
    key: MatchDimension["key"],
    label: string,
    verdict: Verdict,
    weight: number,
  ) => {
    achievable += weight;
    if (verdict === "match") earned += weight;
    else if (verdict === "unknown") earned += weight / 2;
    dimensions.push({ key, label, verdict });
  };

  // ── Followers ──────────────────────────────────────────────────────────
  const min = Number(target.followerMin) || 0;
  const max = Number(target.followerMax) || 0;
  if (min || max) {
    const f = Number(creator.followersCount);
    if (!Number.isFinite(f) || f <= 0) {
      add("followers", "follower count unknown", "unknown", WEIGHTS.followers);
    } else {
      const inBand = (!min || f >= min) && (!max || f <= max);
      if (inBand) {
        add("followers", "in the follower range", "match", WEIGHTS.followers);
      } else {
        const edge = f < min ? min : max;
        const drift = edge > 0 ? Math.abs(f - edge) / edge : 1;
        if (f < min) belowFollowerMin = true;
        if (drift <= NEAR_DRIFT) {
          achievable += WEIGHTS.followers;
          earned += WEIGHTS.followers * NEAR_CREDIT;
          dimensions.push({
            key: "followers",
            label: f < min ? "just under the follower range" : "just over the follower range",
            verdict: "miss",
          });
        } else {
          add(
            "followers",
            f < min ? "well under the follower range" : "well over the follower range",
            "miss",
            WEIGHTS.followers,
          );
        }
      }
    }
  }

  // ── Categories ─────────────────────────────────────────────────────────
  const wantedCats = (target.categories || []).map(norm).filter(Boolean);
  if (wantedCats.length) {
    const has = (creator.categories || []).map(norm).filter(Boolean);
    if (!has.length) {
      add("categories", "no categories on file", "unknown", WEIGHTS.categories);
    } else {
      // Substring both ways, the same comparison the consumer app makes.
      const hits = wantedCats.filter((w) => has.some((h) => h === w || h.includes(w) || w.includes(h)));
      if (hits.length) {
        add(
          "categories",
          hits.length === 1 ? "category match" : `${hits.length} category matches`,
          "match",
          WEIGHTS.categories,
        );
      } else {
        add("categories", "different categories", "miss", WEIGHTS.categories);
      }
    }
  }

  // ── Gender ─────────────────────────────────────────────────────────────
  //
  // Only scored when the brief actually restricts — requiredGender returns
  // null for "Any", for both named, and for absent, which is 66 of the 75
  // live campaigns. A mismatch is flagged rather than excluded here: unlike
  // the sourcing pool, this creator has already applied, and hiding them
  // from the brand would make an in-flight application vanish.
  const needGender = requiredGender(target.gender);
  if (needGender) {
    const theirs = norm(creator.gender);
    if (!theirs) {
      add("gender", "gender not on file", "unknown", WEIGHTS.gender);
    } else if (theirs === needGender) {
      add("gender", `${genderLabel(theirs) || theirs} — matches brief`, "match", WEIGHTS.gender);
    } else {
      genderMismatch = true;
      add("gender", `${genderLabel(theirs) || theirs} — brief asks for ${needGender}`, "miss", WEIGHTS.gender);
    }
  }

  // ── Location ───────────────────────────────────────────────────────────
  const cities = (target.cities || []).map(norm).filter((c) => c && !WILDCARD_CITIES.has(c));
  if (cities.length) {
    const where = norm(creator.location);
    if (!where) {
      add("location", "location not on file", "unknown", WEIGHTS.location);
    } else if (cities.some((city) => where.includes(city) || city.includes(where))) {
      add("location", "city match", "match", WEIGHTS.location);
    } else {
      add("location", "different city", "miss", WEIGHTS.location);
    }
  }

  // ── Engagement ─────────────────────────────────────────────────────────
  const minEr = Number(target.minEngagementRate) || 0;
  if (minEr > 0) {
    const er = Number(creator.engagementRate);
    if (!Number.isFinite(er) || er <= 0) {
      add("engagement", "engagement unknown", "unknown", WEIGHTS.engagement);
    } else if (er >= minEr) {
      add("engagement", `${er.toFixed(1)}% engagement`, "match", WEIGHTS.engagement);
    } else {
      add("engagement", `${er.toFixed(1)}% engagement, brief wants ${minEr}%`, "miss", WEIGHTS.engagement);
    }
  }

  return {
    // No targeting at all means every applicant is an equally good answer;
    // a fabricated 100% would read as a judgement nobody made.
    percent: achievable > 0 ? Math.round((earned / achievable) * 100) : null,
    dimensions,
    belowFollowerMin,
    genderMismatch,
  };
}

/**
 * Order applicants best-fit first.
 *
 * Ties break on follower count, then on the original order, so the sort is
 * stable and a reload does not reshuffle rows that score the same.
 */
export function rankByMatch<T>(
  items: T[],
  score: (item: T) => MatchResult,
  followers: (item: T) => number | null | undefined,
): T[] {
  return items
    .map((item, index) => ({ item, index, result: score(item), f: Number(followers(item)) || 0 }))
    .sort((a, b) => {
      const ap = a.result.percent;
      const bp = b.result.percent;
      // An unscoreable brief leaves everyone equal — fall through to the
      // original order rather than inventing a ranking.
      if (ap !== null && bp !== null && ap !== bp) return bp - ap;
      if (a.f !== b.f) return b.f - a.f;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

/** A short badge tone for a percentage. */
export function matchTone(percent: number | null): "strong" | "fair" | "weak" | "none" {
  if (percent === null) return "none";
  if (percent >= 75) return "strong";
  if (percent >= 45) return "fair";
  return "weak";
}
