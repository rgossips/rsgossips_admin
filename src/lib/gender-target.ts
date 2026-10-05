// A campaign's gender brief, and who it excludes.
//
// MIRRORS rgossips_web/supabase/functions/_shared/gender-match.ts — the two
// cannot import from one another (that one runs in Deno as an edge
// function), so they are hand-synced, the same arrangement as
// subscription-plans.ts against plans.js and cities.ts against
// indianCities.js. Change one, change the other, or the portal will source
// creators the consumer app then refuses to let apply.
//
// Shapes, measured live rather than assumed:
//
//   campaigns.description trailer -> target_gender: string[]
//     ["Any"] 23 · ["Male","Female","Any"] 3 · ["Female"] 6 · ["Male"] 3
//     absent 40.  Only 9 of 75 campaigns restrict anything.
//
//   influencer_profiles.gender  -> null 245 · female 216 · male 29 · non_binary 2
//   influencer_invitations notes trailer `gender` -> female 518 · male 450 ·
//     prefer_not_to_say 29 (997 of 1000 pending invitations carry one)

export type RequiredGender = "male" | "female";

// A brief restricts only when it names exactly one of male/female. "Any"
// anywhere, both named, or nothing at all means everyone is welcome.
export function requiredGender(targetGender: unknown): RequiredGender | null {
  if (!Array.isArray(targetGender) || targetGender.length === 0) return null;
  const low = targetGender.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean);
  if (low.length === 0) return null;
  if (low.includes("any") || low.includes("all")) return null;
  const wantsMale = low.includes("male");
  const wantsFemale = low.includes("female");
  if (wantsMale && wantsFemale) return null;
  if (wantsMale) return "male";
  if (wantsFemale) return "female";
  return null;
}

function normalizeGender(gender: unknown): string | null {
  const v = String(gender ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!v) return null;
  if (v === "m" || v === "male") return "male";
  if (v === "f" || v === "female") return "female";
  return v;
}

// True only for a KNOWN, opposite gender. An unset field, non_binary and
// prefer_not_to_say are never an exclusion: half the registered base has no
// gender on file, and excluding them would quietly halve every pool search
// on a gender-restricted campaign.
export function genderExcludes(required: RequiredGender | null, candidateGender: unknown): boolean {
  if (!required) return false;
  const theirs = normalizeGender(candidateGender);
  if (!theirs) return false;
  if (theirs === required) return false;
  return theirs === "male" || theirs === "female";
}

export const GENDER_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_to_say: "Not stated",
};

export function genderLabel(gender: unknown): string | null {
  const v = normalizeGender(gender);
  if (!v) return null;
  return GENDER_LABEL[v] || v;
}
