// Single owner of the content-language option list, used by the campaign
// targeting form and the influencer invite form. Both used to carry their
// own hardcoded array and had drifted (campaigns was missing Odia + Urdu),
// so a creator could be tagged with a language no campaign could target.
//
// Unlike cities (a comma-joined scalar — see cities.ts), languages persist
// as a JSON array: `metadata.languages` on influencer_invitations and
// `target_languages` in the campaigns.description trailer. Adding options
// is therefore purely additive — previously-saved rows keep matching.
//
// LABELS MUST NOT BE SUBSTRINGS OF ONE ANOTHER. The RS_Gossips
// `list-influencers` edge function matches languages bidirectionally:
//   il.includes(sel) || sel.includes(il)
// so an entry like "Rajasthani/Marwari" alongside "Marwari" would make the
// two cross-match and silently widen every filter. Keep labels to a single
// canonical token — no slashes, no parenthetical alt-names.

// Carry the overwhelming majority of monetised Indian creator content.
export const LANGUAGES_TIER_1: string[] = [
  "Hindi",
  "English",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Bengali",
  "Marathi",
  "Gujarati",
  "Punjabi",
  "Odia",
  "Urdu",
];

// Regionally strong with real creator economies. Note that several of these
// (Bhojpuri, Haryanvi, Tulu, Chhattisgarhi, Awadhi, Magahi, Rajasthani) are
// NOT Eighth Schedule languages but out-earn several that are — which is why
// this list is creator-led rather than a copy of the official 22.
export const LANGUAGES_TIER_2: string[] = [
  "Bhojpuri",
  "Assamese",
  "Haryanvi",
  "Rajasthani",
  "Tulu",
  "Konkani",
  "Maithili",
  "Chhattisgarhi",
  "Awadhi",
  "Magahi",
  "Nepali",
  "Manipuri",
];

// Remaining Eighth Schedule languages — thin creator presence, included so
// the official 22 are all selectable.
export const LANGUAGES_TIER_3: string[] = [
  "Bodo",
  "Dogri",
  "Kashmiri",
  "Sanskrit",
  "Santali",
  "Sindhi",
];

// Flat list in tier order — most-used first so the common picks sit at the
// top of the picker. This is what the forms should import.
export const INDIAN_LANGUAGES: string[] = [
  ...LANGUAGES_TIER_1,
  ...LANGUAGES_TIER_2,
  ...LANGUAGES_TIER_3,
];
