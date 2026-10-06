// "Here's what else is open" — the block that goes at the foot of a
// creator-facing email.
//
// The whole value is that every suggestion is one they can ACTUALLY apply
// to. A list that includes a campaign whose deadline passed, or one whose
// brief asks for the other gender, is worse than no list: the creator
// clicks, finds a dead end, and learns the suggestions are noise. So this
// applies the same rules the live feed and apply-campaign do, rather than
// its own looser version:
//
//   - status `active` only — `coming_soon` is visible but not applicable,
//     and draft/paused/completed are not visible at all
//   - the application window still open (the 24h grace in campaign-deadline.ts)
//   - the gender brief satisfied (requiredGender, the single owner)
//   - the follower band satisfied
//   - not one they have already applied to
//
// Ranked by category overlap so the first suggestion is the most plausible,
// then by soonest deadline — the one most worth acting on today.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";
import { applicationsClosedBefore } from "@/lib/campaign-deadline";
import { genderExcludes, requiredGender } from "@/lib/gender-target";

export type CampaignSuggestion = {
  id: string;
  title: string;
  brandName: string;
  /** "Paid", "Barter" or "Paid + Product" — what a creator scans for. */
  typeLabel: string;
  /** Formatted pay, or null on a pure barter campaign. */
  payLabel: string | null;
  deadline: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  paid: "Paid",
  barter: "Barter",
  hybrid: "Paid + Product",
};

const CAMPAIGN_TRAILER = "\n\n---\n";
function parseTrailer(description: string | null | undefined): Record<string, unknown> {
  const raw = String(description || "");
  const at = raw.indexOf(CAMPAIGN_TRAILER);
  const json = at !== -1 ? raw.slice(at + CAMPAIGN_TRAILER.length) : raw.trimStart().startsWith("{") ? raw : "";
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Campaigns this creator could apply to right now.
 *
 * Returns an empty list on any failure — an email that simply omits the
 * block is fine, while one that suggests a campaign the creator cannot take
 * is a broken promise.
 */
export async function suggestCampaignsForCreator(
  admin: SupabaseClient,
  influencerId: string | null,
  opts?: { limit?: number; excludeCampaignId?: string },
): Promise<CampaignSuggestion[]> {
  const limit = opts?.limit ?? 3;
  try {
    const [profileRes, campaignsRes, appliedRes] = await Promise.all([
      influencerId
        ? admin
            .from("influencer_profiles")
            .select("gender, followers_count, categories")
            .eq("influencer_id", influencerId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from("campaigns")
        .select(
          "campaign_id, title, campaign_type, budget_per_influencer, application_deadline, target_categories, target_follower_min, target_follower_max, description, brand_profiles(brand_name), brand_invitations(brand_name)",
        )
        .eq("status", "active"),
      influencerId
        ? admin.from("campaign_applications").select("campaign_id").eq("influencer_id", influencerId)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (campaignsRes.error) {
      logError("campaign-suggestions", campaignsRes.error, { influencerId });
      return [];
    }

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const profile = (profileRes as any).data as
      | { gender: string | null; followers_count: number | null; categories: string[] | null }
      | null;
    const alreadyApplied = new Set(
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (((appliedRes as any).data || []) as { campaign_id: string }[]).map((r) => r.campaign_id),
    );
    const cutoff = applicationsClosedBefore();
    const followers = Number(profile?.followers_count) || 0;
    const theirCategories = (profile?.categories || []).map((c) => String(c).toLowerCase());

    const scored: { s: CampaignSuggestion; overlap: number; deadline: number }[] = [];
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    for (const c of (campaignsRes.data || []) as any[]) {
      if (c.campaign_id === opts?.excludeCampaignId) continue;
      if (alreadyApplied.has(c.campaign_id)) continue;
      // A campaign with no deadline never closes; one with a past deadline is
      // already gone from the creator's feed.
      if (c.application_deadline && c.application_deadline < cutoff) continue;

      const meta = parseTrailer(c.description);
      if (genderExcludes(requiredGender(meta.target_gender), profile?.gender)) continue;

      // Only enforce the band when we know the creator's count — a missing
      // follower count should not silently empty the list.
      if (followers > 0) {
        const min = Number(c.target_follower_min) || 0;
        const max = Number(c.target_follower_max) || 0;
        if (min && followers < min) continue;
        if (max && followers > max) continue;
      }

      const cats = (c.target_categories || []).map((x: string) => String(x).toLowerCase());
      const overlap = cats.filter((x: string) => theirCategories.includes(x)).length;
      const pay = Number(c.budget_per_influencer) || 0;
      scored.push({
        s: {
          id: c.campaign_id,
          title: String(c.title || "Untitled campaign"),
          brandName: c.brand_profiles?.brand_name || c.brand_invitations?.brand_name || "RGossips",
          typeLabel: TYPE_LABEL[String(c.campaign_type || "").toLowerCase()] || "Collab",
          payLabel: pay > 0 ? `₹${pay.toLocaleString("en-IN")}` : null,
          deadline: c.application_deadline || null,
        },
        overlap,
        deadline: c.application_deadline ? new Date(c.application_deadline).getTime() : Number.MAX_SAFE_INTEGER,
      });
    }

    scored.sort((a, b) => b.overlap - a.overlap || a.deadline - b.deadline);
    return scored.slice(0, limit).map((x) => x.s);
  } catch (e) {
    logError("campaign-suggestions.threw", e, { influencerId });
    return [];
  }
}

const SITE = "https://rgossips.com";

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/**
 * The HTML block. Returns "" for an empty list, so a caller can concatenate
 * it unconditionally and an email with nothing to suggest simply ends.
 */
export function renderSuggestionsHtml(suggestions: CampaignSuggestion[], heading = "Open right now"): string {
  if (!suggestions.length) return "";
  const rows = suggestions
    .map((s) => {
      const by = fmtDate(s.deadline);
      const meta = [s.typeLabel, s.payLabel, by ? `apply by ${by}` : null].filter(Boolean).join(" &middot; ");
      return `
        <tr><td style="padding:0 0 10px 0;">
          <a href="${SITE}/influencer/offers/${s.id}" style="display:block;padding:12px 14px;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;text-decoration:none;">
            <div style="font-size:14px;font-weight:700;color:#111827;">${esc(s.title)}</div>
            <div style="font-size:12px;color:#6B7280;margin-top:2px;">${esc(s.brandName)}</div>
            <div style="font-size:11px;color:#6366F1;font-weight:600;margin-top:6px;">${meta}</div>
          </a>
        </td></tr>`;
    })
    .join("");

  return `
          <div style="margin:28px 0 0 0;padding:18px 16px 8px 16px;background:#F9FAFB;border-radius:14px;">
            <p style="margin:0 0 12px 0;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:1px;">${esc(heading)}</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${rows}</table>
          </div>`;
}

/** The plain-text twin, for the same reason every template carries one. */
export function renderSuggestionsText(suggestions: CampaignSuggestion[], heading = "OPEN RIGHT NOW"): string {
  if (!suggestions.length) return "";
  const lines = suggestions.map((s) => {
    const by = fmtDate(s.deadline);
    const meta = [s.typeLabel, s.payLabel, by ? `apply by ${by}` : null].filter(Boolean).join(" · ");
    return `  - ${s.title} (${s.brandName}) — ${meta}\n    ${SITE}/influencer/offers/${s.id}`;
  });
  return ["", heading, ...lines].join("\n");
}
