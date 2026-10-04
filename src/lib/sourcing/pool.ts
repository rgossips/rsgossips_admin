// Finding creators in our own database who fit a campaign.
//
// The manual process starts with an admin researching creators on Instagram.
// Most of the time the people they end up DMing are already in our database
// — 466 registered creators and 1,680 pending invitations — so the first
// question a sourcing list should answer is "who do we already have?"
//
// Relevance is scored rather than filtered. A hard filter on every targeting
// field returns nothing on a campaign that asks for Beauty creators in
// Mumbai with 5-10k followers; a score surfaces the near misses and lets the
// admin judge. The campaign's own numbers are a brief, not a specification.

export type PoolCandidate = {
  influencerId: string | null;
  invitationId: string | null;
  name: string;
  handle: string;
  followers: number | null;
  categories: string[];
  location: string | null;
  engagementRate: number | null;
  /** Registered on the platform, or only invited so far. */
  registered: boolean;
  score: number;
  reasons: string[];
  /** Already on this campaign's sourcing list. */
  alreadySourced: boolean;
  /** Already applied through the portal. */
  alreadyApplied: boolean;
};

export type PoolTargeting = {
  categories?: string[] | null;
  cities?: string[] | null;
  followerMin?: number | null;
  followerMax?: number | null;
};

const norm = (s: unknown) => String(s || "").trim().toLowerCase();

// "All India" is the brief's way of saying "anywhere" — treating it as a
// city name matches nobody.
const WILDCARD_CITIES = new Set(["all india", "all", "anywhere", "pan india"]);

export function scoreCandidate(
  c: { followers_count?: number | null; categories?: string[] | null; location?: string | null; engagement_rate?: number | null },
  target: PoolTargeting,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Category overlap is the strongest signal: a beauty brief wants beauty
  // creators far more than it wants a particular follower count.
  const wanted = (target.categories || []).map(norm).filter(Boolean);
  const has = (c.categories || []).map(norm);
  if (wanted.length) {
    const hits = wanted.filter((w) => has.some((h) => h === w || h.includes(w) || w.includes(h)));
    if (hits.length) {
      score += 50 + (hits.length - 1) * 10;
      reasons.push(hits.length === 1 ? "category match" : `${hits.length} category matches`);
    }
  } else {
    score += 20; // no category brief: everyone is equally plausible
  }

  // Followers inside the band, with partial credit for near misses — a
  // creator at 11k on a 1-10k brief is worth showing.
  const f = Number(c.followers_count) || 0;
  const min = Number(target.followerMin) || 0;
  const max = Number(target.followerMax) || 0;
  if (min || max) {
    const inBand = (!min || f >= min) && (!max || f <= max);
    if (inBand && f > 0) {
      score += 30;
      reasons.push("follower range");
    } else if (f > 0) {
      const edge = f < min ? min : max;
      const drift = edge > 0 ? Math.abs(f - edge) / edge : 1;
      if (drift <= 0.5) {
        score += 12;
        reasons.push("near the follower range");
      }
    }
  } else if (f > 0) {
    score += 10;
  }

  // City, unless the brief says anywhere. `location` is a comma-joined
  // scalar (see CLAUDE.md, "Cities / location"), so this is a substring
  // test in both directions — the same thing the consumer app does.
  const cities = (target.cities || []).map(norm).filter((x) => x && !WILDCARD_CITIES.has(x));
  if (cities.length) {
    const where = norm(c.location);
    if (where && cities.some((city) => where.includes(city) || city.includes(where))) {
      score += 20;
      reasons.push("city match");
    }
  }

  // A tie-breaker, not a qualifier.
  const er = Number(c.engagement_rate) || 0;
  if (er >= 3) {
    score += 8;
    reasons.push(`${er.toFixed(1)}% ER`);
  } else if (er > 0) {
    score += 3;
  }

  return { score, reasons };
}

// Rank, then cut. The cut is generous on purpose: an admin scanning for
// someone they recognise would rather scroll than re-search.
export function rankCandidates(candidates: PoolCandidate[], limit = 60): PoolCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      // Anyone already on the campaign sinks: they are not a choice.
      const aUsed = a.alreadySourced || a.alreadyApplied ? 1 : 0;
      const bUsed = b.alreadySourced || b.alreadyApplied ? 1 : 0;
      if (aUsed !== bUsed) return aUsed - bUsed;
      if (b.score !== a.score) return b.score - a.score;
      return (b.followers || 0) - (a.followers || 0);
    })
    .slice(0, limit);
}
