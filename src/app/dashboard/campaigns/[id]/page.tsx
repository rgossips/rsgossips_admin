import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { CampaignDetailActions } from "./detail-actions";
import { EditCampaignButton } from "./edit-campaign";
import { RefreshButton } from "@/components/refresh-button";
import { ApplicationsList } from "./applications";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("*, brand_profiles(brand_name, logo_url), brand_invitations(brand_name, logo_url)")
    .eq("campaign_id", id)
    .single();

  if (error || !campaign) return notFound();

  // Fetch applications for this campaign
  const { data: applications } = await supabase
    .from("campaign_applications")
    .select("*, influencer_profiles(full_name, username, profile_photo_url, followers_count, instagram_handle, categories, bio, engagement_rate, email, media_kit_published)")
    .eq("campaign_id", id)
    .order("created_at", { ascending: false });

  // Resolve brand info from either registered profile or invitation
  const brandName = campaign.brand_profiles?.brand_name || campaign.brand_invitations?.brand_name || "—";
  const brandLogo = campaign.brand_profiles?.logo_url || campaign.brand_invitations?.logo_url || "";
  const isInvitedBrand = !campaign.brand_id && campaign.brand_invitation_id;

  // Slots: count applications that are approved/submitted/revision_needed/accepted/completed (not rejected/withdrawn/pending)
  const filledSlots = (applications || []).filter((a: any) =>
    ["approved", "submitted", "revision_needed", "accepted", "completed"].includes(a.status)
  ).length;
  const totalSlots = campaign.max_influencers || 0;
  const availableSlots = Math.max(0, totalSlots - filledSlots);

  const statusConfig: Record<string, { bg: string; dot: string; label: string }> = {
    draft: { bg: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400", dot: "bg-gray-400", label: "Draft" },
    active: { bg: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", label: "Active" },
    paused: { bg: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400", dot: "bg-yellow-500", label: "Paused" },
    completed: { bg: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400", dot: "bg-blue-500", label: "Completed" },
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

  const deliverableIcons: Record<string, { icon: string; color: string; bgColor: string }> = {
    reels: { icon: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z", color: "text-rose-600 dark:text-rose-400", bgColor: "bg-rose-50 dark:bg-rose-900/20" },
    posts: { icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-50 dark:bg-blue-900/20" },
    stories: { icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-50 dark:bg-amber-900/20" },
    videos: { icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z", color: "text-purple-600 dark:text-purple-400", bgColor: "bg-purple-50 dark:bg-purple-900/20" },
  };

  const tierLabels: Record<string, string> = {
    nano: "Nano (1K-10K)",
    micro: "Micro (10K-100K)",
    macro: "Macro (100K-1M)",
    mega: "Mega (1M+)",
    all: "All Tiers",
  };

  const typeLabels: Record<string, string> = {
    barter: "Barter",
    paid: "Paid",
    hybrid: "Hybrid",
  };

  // Days remaining
  const endDate = campaign.campaign_end_date ? new Date(campaign.campaign_end_date) : null;
  const daysRemaining = endDate ? Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

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
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{campaign.title || "Campaign"}</h1>
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
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-semibold">Invited</span>
              )}
              {campaign.created_by_admin && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-semibold">By Admin</span>
              )}
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span className="text-sm text-gray-400 dark:text-gray-500">{typeLabels[campaign.campaign_type] || campaign.campaign_type}</span>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span className="text-sm text-gray-400 dark:text-gray-500">Created {formatDate(campaign.created_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <EditCampaignButton campaign={campaign} description={description} bannerUrl={bannerUrl} galleryUrls={galleryUrls} engagementRate={engagementRate} deliverables={deliverables} />
          <CampaignDetailActions campaignId={campaign.campaign_id} status={campaign.status} />
          <RefreshButton />
        </div>
      </div>

      {/* Banner Image */}
      {bannerUrl && (
        <div className="mb-6 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800">
          <img src={bannerUrl} alt="Campaign Banner" className="w-full h-56 object-cover" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Main Content */}
        <div className="lg:col-span-2 space-y-6">
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
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Description</h2>
                </div>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{description}</p>
              </div>
            </div>
          )}

          {/* Applications */}
          <ApplicationsList applications={applications || []} budgetPerInfluencer={campaign.budget_per_influencer || 0} />

          {/* Content Deliverables */}
          {Object.keys(deliverables).length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-pink-50 dark:bg-pink-900/30 flex items-center justify-center">
                    <svg className="w-4 h-4 text-pink-600 dark:text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Content Deliverables</h2>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {Object.entries(deliverables).map(([type, count]) => {
                    const config = deliverableIcons[type] || { icon: "", color: "text-gray-600", bgColor: "bg-gray-50 dark:bg-gray-800" };
                    return (
                      <div key={type} className={`${config.bgColor} rounded-2xl p-5 text-center`}>
                        <div className="flex justify-center mb-2">
                          <svg className={`w-5 h-5 ${config.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
                          </svg>
                        </div>
                        <p className={`text-3xl font-bold ${config.color}`}>{count}</p>
                        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 capitalize mt-1 uppercase tracking-wider">{type}</p>
                      </div>
                    );
                  })}
                </div>
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
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Influencer Requirements</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoItem icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" label="Follower Range" value={`${(campaign.target_follower_min || 0).toLocaleString()} — ${(campaign.target_follower_max || 0).toLocaleString()}`} />
                <InfoItem icon="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" label="Influencer Tier" value={tierLabels[campaign.target_influencer_tier] || campaign.target_influencer_tier || "—"} />
                {engagementRate && (
                  <InfoItem icon="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" label="Min. Engagement Rate" value={`${engagementRate}%`} />
                )}
                <InfoItem icon="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" label="Target Cities" value={campaign.target_cities?.join(", ") || "—"} />
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
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Gallery</h2>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{galleryUrls.length} images</span>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {galleryUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="group rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                      <img src={url} alt={`Gallery ${i + 1}`} className="w-full h-32 object-cover group-hover:scale-105 transition-transform duration-300" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Raw data */}
          <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <summary className="px-6 py-4 text-sm font-medium text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              Raw Campaign Data
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
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Overview</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <StatRow label="Slots" value={totalSlots > 0 ? `${availableSlots} / ${totalSlots} available` : "—"} />
              <StatRow label="Campaign Type" value={typeLabels[campaign.campaign_type] || campaign.campaign_type || "—"} />
              <StatRow label="Budget Total" value={campaign.budget_total ? `₹${campaign.budget_total.toLocaleString()}` : "—"} />
              <StatRow label="Per Influencer" value={campaign.budget_per_influencer ? `₹${campaign.budget_per_influencer.toLocaleString()}` : "—"} />
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
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Schedule</h2>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <DateItem label="Start Date" date={formatDate(campaign.campaign_start_date)} />
              <DateItem label="Deadline" date={formatDate(campaign.campaign_end_date || campaign.application_deadline)} />
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
                    {daysRemaining > 0 ? "Days Remaining" : "Campaign Ended"}
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
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Categories</h2>
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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-6 py-3.5">
      <span className="text-[13px] text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{value}</span>
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
