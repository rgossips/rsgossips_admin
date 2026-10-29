import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { CampaignDetailActions } from "./detail-actions";
import { EditCampaignButton } from "./edit-campaign";
import { RefreshButton } from "@/components/refresh-button";
import { ApplicationsSummary } from "./applications-summary";
import { countSeats } from "@/lib/sourcing/seats";
import { isAdminOrAbove, isSuperAdmin } from "@/lib/require-super-admin";
import { DeleteCampaignButton } from "./delete-campaign";
import { CampaignReviewActions } from "./review-actions";
import { ExportRosterButton } from "./export-roster-button";
import { invitationAsProfile } from "@/lib/invitation-meta";
import { getTranslations } from "next-intl/server";
import { listAllAuthUsers } from "@/lib/phone-search";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();
  const canWrite = await isAdminOrAbove();
  const superAdmin = await isSuperAdmin();
  const t = await getTranslations("DashboardCampaignsId");

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("*, brand_profiles(brand_name, logo_url), brand_invitations(brand_name, logo_url)")
    .eq("campaign_id", id)
    .single();

  if (error || !campaign) return notFound();

  // Fetch applications for this campaign
  const { data: applications } = await supabase
    .from("campaign_applications")
    // location + gender are here for the match ranking (lib/application-match.ts).
    // Both columns exist and are verified present; they are sparse (location
    // 14%, gender 51% of profiles) which the scorer treats as "unknown"
    // rather than as a mismatch.
    .select("*, influencer_profiles(full_name, username, profile_photo_url, followers_count, instagram_handle, categories, bio, engagement_rate, email, media_kit_published, location, gender)")
    .eq("campaign_id", id)
    .order("created_at", { ascending: false });

  // An application can belong to an INVITATION rather than a profile — an
  // outreach creator approved before they ever signed up (rgossips_web
  // migration 088). PostgREST returns no influencer_profiles for those, so
  // without this the row would render with no name, no handle and no
  // followers, and the match scorer would read every dimension as unknown.
  //
  // Dressed as a profile HERE, once, rather than teaching the list, the
  // scorer and the Excel export that a creator comes in two shapes.
  const unlinked = (applications || []).filter(
    (a) => !a.influencer_profiles && a.influencer_invitation_id,
  );
  if (unlinked.length > 0) {
    const { data: invites } = await supabase
      .from("influencer_invitations")
      .select("id, full_name, instagram_username, profile_photo_url, notes")
      .in("id", [...new Set(unlinked.map((a) => a.influencer_invitation_id))]);
    const byId = new Map((invites || []).map((i) => [String(i.id), i]));
    for (const a of unlinked) {
      const inv = byId.get(String(a.influencer_invitation_id));
      // A missing invitation leaves the row as it was. Better a sparse row
      // than a fabricated creator.
      if (inv) a.influencer_profiles = invitationAsProfile(inv);
    }
  }

  // Resolve brand info from either registered profile or invitation
  const brandName = campaign.brand_profiles?.brand_name || campaign.brand_invitations?.brand_name || "—";
  const brandLogo = campaign.brand_profiles?.logo_url || campaign.brand_invitations?.logo_url || "";
  const isInvitedBrand = !campaign.brand_id && campaign.brand_invitation_id;

  // Seats, from lib/sourcing/seats.ts — the single owner of this sum.
  // This page used to count applications only, with its own hand-written
  // status list that had drifted (no live_submitted, no payment), so it
  // showed free slots the outreach tracker knew were taken. countSeats
  // reads both intake paths and counts a creator who arrived by both of
  // them once.
  const { data: seatBookings } = await supabase
    .from("campaign_bookings")
    .select("influencer_id, instagram_username, stage")
    .eq("campaign_id", id);
  const seats = countSeats(campaign.max_influencers, applications || [], seatBookings || []);
  const totalSlots = seats.capacity ?? 0;

  const statusConfig: Record<string, { bg: string; dot: string; label: string }> = {
    draft: { bg: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400", dot: "bg-gray-400", label: t("status.draft") },
    active: { bg: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", label: t("status.active") },
    paused: { bg: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400", dot: "bg-yellow-500", label: t("status.paused") },
    completed: { bg: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400", dot: "bg-blue-500", label: t("status.completed") },
  };

  const statusInfo = statusConfig[campaign.status] || statusConfig.draft;

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  // Parse content_types_required (format: "reels:3", "posts:2", etc.)
  const deliverables: Record<string, number> = {};
  if (campaign.content_types_required) {
    for (const entry of campaign.content_types_required) {
      const [type, count] = entry.split(":");
      if (type && count) deliverables[type] = parseInt(count);
    }
  }

  // Parse metadata from description (banner + gallery URLs)
  let description = campaign.description || "";
  let bannerUrl: string | null = null;
  let galleryUrls: string[] = [];
  let engagementRate: number | null = null;

  const metaSeparator = description.indexOf("\n\n---\n");
  if (metaSeparator !== -1) {
    const jsonStr = description.slice(metaSeparator + 5);
    description = description.slice(0, metaSeparator);
    try {
      const meta = JSON.parse(jsonStr);
      bannerUrl = meta.banner_image || null;
      galleryUrls = meta.gallery_images || [];
      engagementRate = meta.min_engagement_rate || null;
    } catch { /* ignore */ }
  } else if (description.startsWith("{")) {
    try {
      const meta = JSON.parse(description);
      bannerUrl = meta.banner_image || null;
      galleryUrls = meta.gallery_images || [];
      engagementRate = meta.min_engagement_rate || null;
      description = "";
    } catch { /* ignore */ }
  }

  // Colour per deliverable type. The SVG paths that used to live here went
  // with the icons; only the palette is still read, so the name is now
  // slightly off but every call site uses it and renaming would touch more
  // than it is worth.
  const deliverableIcons: Record<string, { color: string; bgColor: string }> = {
    reels: { color: "text-rose-600 dark:text-rose-400", bgColor: "bg-rose-50 dark:bg-rose-900/20" },
    posts: { color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-50 dark:bg-blue-900/20" },
    stories: { color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-50 dark:bg-amber-900/20" },
    videos: { color: "text-purple-600 dark:text-purple-400", bgColor: "bg-purple-50 dark:bg-purple-900/20" },
  };

  const tierLabels: Record<string, string> = {
    nano: t("tier.nano"),
    micro: t("tier.micro"),
    macro: t("tier.macro"),
    mega: t("tier.mega"),
    all: t("tier.all"),
  };

  const typeLabels: Record<string, string> = {
    barter: t("type.barter"),
    paid: t("type.paid"),
    hybrid: t("type.hybrid"),
  };

  // Days remaining
  const endDate = campaign.campaign_end_date ? new Date(campaign.campaign_end_date) : null;
  const daysRemaining = endDate ? Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

  // Phones live on auth.users, not influencer_profiles, which is why this
  // panel showed a "(from auth)" placeholder. listAllAuthUsers is cached for
  // 120s and shared with the influencer list, so this costs nothing extra on
  // a warm cache.
  const applicantIds = new Set((applications || []).map((a: { influencer_id: string }) => a.influencer_id).filter(Boolean));
  const phoneMap = new Map<string, string>();
  if (applicantIds.size > 0) {
    try {
      for (const u of await listAllAuthUsers(supabase)) {
        if (u.phone && applicantIds.has(u.id)) phoneMap.set(u.id, u.phone);
      }
    } catch {
      /* no phones is a degraded panel, not a broken page */
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/campaigns"
            className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{campaign.title || t("campaignFallbackTitle")}</h1>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                {statusInfo.label}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              {brandLogo ? (
                <img src={brandLogo} alt="" className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-white">{brandName[0] || "?"}</span>
                </div>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">{brandName}</span>
              {isInvitedBrand && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-semibold">{t("invited")}</span>
              )}
              {campaign.created_by_admin && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-semibold">{t("byAdmin")}</span>
              )}
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span className="text-sm text-gray-400 dark:text-gray-500">{typeLabels[campaign.campaign_type] || campaign.campaign_type}</span>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span className="text-sm text-gray-400 dark:text-gray-500">{t("created", { date: formatDate(campaign.created_at) })}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && campaign.status === "under_review" && (
            <CampaignReviewActions campaignId={campaign.campaign_id} />
          )}
          {canWrite && <EditCampaignButton campaign={campaign} description={description} bannerUrl={bannerUrl} galleryUrls={galleryUrls} engagementRate={engagementRate} deliverables={deliverables} />}
          {canWrite && <CampaignDetailActions campaignId={campaign.campaign_id} status={campaign.status} />}
          {superAdmin && (
            <DeleteCampaignButton
              campaignId={campaign.campaign_id}
              title={campaign.title || ""}
              applicationCount={applications?.length || 0}
            />
          )}
          {/* The second intake path. Same seats, different door.

              Sized to match Edit, the status dropdown and Delete exactly
              — px-4 py-2.5 text-sm — rather than carrying its own h-9
              px-3 text-[13px], which rendered it 36px tall in a row of
              40px buttons with smaller text and tighter padding. A fixed
              height is what made the two-word label need a wrap guard in
              the first place; the padding now sets the height, as it does
              for every neighbour, and whitespace-nowrap only keeps the
              label on one line in a tight row. */}
          {/* Who should be on this campaign, from the creators we already
              have. Sits beside the tracker rather than inside it because
              it is the step BEFORE tracking: you find people, message
              them, and only then does anyone need chasing. Same padding
              as its neighbours — px-4 py-2.5 text-sm — so the row keeps
              one height. */}
          {canWrite && (
            <Link
              href={`/dashboard/campaigns/${campaign.campaign_id}/find-creators`}
              className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Find matching creators
            </Link>
          )}
          {canWrite && (
            <Link
              href={`/dashboard/campaigns/${campaign.campaign_id}/sourcing`}
              className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
            >
              Outreach tracker
            </Link>
          )}
          <RefreshButton />
        </div>
      </div>

      {/* Banner Image */}
      {bannerUrl && (
        <div className="mb-6 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800">
          <img src={bannerUrl} alt={t("campaignBannerAlt")} className="w-full h-56 object-cover" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Applications — the HEADLINE only.

              The list itself moved to /applications, a full-width page with
              status tabs. It had grown a match ranking, an off-brief filter,
              bulk reject and a dozen per-row actions, and it was sitting in
              a two-thirds column underneath the brief: the page an admin
              opens to make decisions was the hardest place to make them.
              What belongs here is the number and whether it needs
              attention. */}
          <ApplicationsSummary campaignId={campaign.campaign_id} applications={applications || []} />

          {/* Description */}
          {description && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                    <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                  </div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("description")}</h2>
                </div>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{description}</p>
              </div>
            </div>
          )}

          {/* Influencer Requirements */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("influencerRequirements")}</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoItem icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" label={t("followerRange")} value={`${(campaign.target_follower_min || 0).toLocaleString()} — ${(campaign.target_follower_max || 0).toLocaleString()}`} />
                <InfoItem icon="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" label={t("influencerTier")} value={tierLabels[campaign.target_influencer_tier] || campaign.target_influencer_tier || "—"} />
                {engagementRate && (
                  <InfoItem icon="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" label={t("minEngagementRate")} value={`${engagementRate}%`} />
                )}
                <InfoItem icon="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" label={t("targetCities")} value={campaign.target_cities?.join(", ") || "—"} />
              </div>
            </div>
          </div>

          {/* Gallery */}
          {galleryUrls.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
                    <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("gallery")}</h2>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t("galleryImages", { count: galleryUrls.length })}</span>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {galleryUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="group rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                      <img src={url} alt={t("galleryImageAlt", { index: i + 1 })} className="w-full h-32 object-cover group-hover:scale-105 transition-transform duration-300" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Raw data */}
          <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <summary className="px-6 py-4 text-sm font-medium text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              {t("rawCampaignData")}
            </summary>
            <div className="px-6 pb-6">
              <pre className="text-xs text-gray-500 dark:text-gray-400 overflow-auto whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
                {JSON.stringify(campaign, null, 2)}
              </pre>
            </div>
          </details>
        </div>

        {/* Right — Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("overview")}</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <StatRow
                label={t("slots")}
                value={totalSlots > 0 ? t("slotsTaken", { taken: seats.taken, total: totalSlots }) : "—"}
                tone={seats.over ? "warn" : undefined}
                sub={
                  totalSlots > 0
                    ? [
                        t("slotsBreakdown", { applied: seats.fromApplications, sourced: seats.fromBookings }),
                        seats.overlap > 0 ? t("slotsOverlap", { count: seats.overlap }) : "",
                        seats.over ? t("slotsOver") : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined
                }
                // Under the slots line because this is the number it
                // explains: the sheet carries Source and Holds Seat
                // columns, so filtering Holds Seat to Yes reproduces the
                // figure above it exactly. Viewers may download it — it is
                // a read — but it carries email, phone and home addresses,
                // so the action is gated and audit-logged server-side.
                action={<ExportRosterButton campaignId={campaign.campaign_id} />}
              />
              <StatRow label={t("campaignType")} value={typeLabels[campaign.campaign_type] || campaign.campaign_type || "—"} />
              <StatRow label={t("budgetTotal")} value={campaign.budget_total ? `₹${campaign.budget_total.toLocaleString()}` : "—"} />
              <StatRow label={t("perInfluencer")} value={campaign.budget_per_influencer ? `₹${campaign.budget_per_influencer.toLocaleString()}` : "—"} />
              {/* Deliverables, as a row of this card rather than a card of
                  its own. It is three numbers describing the brief, which is
                  what every other row here is; as a full-width panel further
                  down the page it took a whole screen band to say "1 reel, 2
                  stories". Hidden entirely when the brief names none —
                  an empty band read as "deliverables not set up yet". */}
              {Object.keys(deliverables).length > 0 && (
                <div className="px-6 py-3.5">
                  <p className="text-[13px] text-gray-500 dark:text-gray-400">{t("contentDeliverables")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(deliverables).map(([type, count]) => {
                      const config = deliverableIcons[type] || { color: "text-gray-600", bgColor: "bg-gray-50 dark:bg-gray-800" };
                      return (
                        <div key={type} className={`${config.bgColor} flex items-center gap-2 rounded-xl px-3 py-2`}>
                          <span className={`text-base font-bold ${config.color}`}>{count}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{type}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Schedule */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-50 dark:bg-cyan-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-cyan-600 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("schedule")}</h2>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <DateItem label={t("startDate")} date={formatDate(campaign.campaign_start_date)} />
              <DateItem label={t("applicationDeadline")} date={formatDate(campaign.application_deadline)} />
              <DateItem label={t("campaignEndDate")} date={formatDate(campaign.campaign_end_date)} />
              {daysRemaining !== null && (
                <div className={`mt-2 px-4 py-3 rounded-xl text-center ${
                  daysRemaining > 7
                    ? "bg-emerald-50 dark:bg-emerald-900/20"
                    : daysRemaining > 0
                    ? "bg-yellow-50 dark:bg-yellow-900/20"
                    : "bg-red-50 dark:bg-red-900/20"
                }`}>
                  <p className={`text-2xl font-bold ${
                    daysRemaining > 7
                      ? "text-emerald-600 dark:text-emerald-400"
                      : daysRemaining > 0
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-red-600 dark:text-red-400"
                  }`}>
                    {daysRemaining > 0 ? daysRemaining : 0}
                  </p>
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-0.5">
                    {daysRemaining > 0 ? t("daysRemaining") : t("campaignEnded")}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Categories */}
          {campaign.target_categories && campaign.target_categories.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                    <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("categories")}</h2>
                </div>
              </div>
              <div className="p-5 flex flex-wrap gap-2">
                {campaign.target_categories.map((cat: string) => (
                  <span
                    key={cat}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/50">
      <div className="w-9 h-9 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  sub,
  tone,
  action,
}: {
  label: string;
  value: string;
  /** A quieter second line under the value, for a breakdown. */
  sub?: string;
  tone?: "warn";
  /** Something to do with this stat, sitting under the breakdown. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-6 py-3.5">
      <span className="text-[13px] text-gray-500 dark:text-gray-400">{label}</span>
      <span className="flex flex-col items-end text-right">
        <span
          className={`text-[13px] font-semibold ${
            tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"
          }`}
        >
          {value}
        </span>
        {sub && <span className="text-[11px] text-gray-400">{sub}</span>}
        {action}
      </span>
    </div>
  );
}

function DateItem({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
      <div className="flex-1 flex items-center justify-between">
        <span className="text-[13px] text-gray-500 dark:text-gray-400">{label}</span>
        <span className="text-[13px] font-medium text-gray-900 dark:text-white">{date}</span>
      </div>
    </div>
  );
}
