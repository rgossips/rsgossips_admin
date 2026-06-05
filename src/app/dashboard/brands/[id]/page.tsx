import { createAdminClient } from "@/utils/supabase/admin";
import { notFound } from "next/navigation";
import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";
import { EditBrandButton } from "./edit-brand";
import { DeleteBrandButton } from "./delete-brand";
import { isSuperAdmin, isAdminOrAbove } from "@/lib/require-super-admin";

export default async function BrandDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { id } = await params;
  const { status: filterStatus } = await searchParams;
  const supabase = createAdminClient();

  // Try brand_profiles first, then brand_invitations
  let brand: any = null;
  let isInvited = false;

  const { data: profile } = await supabase.from("brand_profiles").select("*").eq("brand_id", id).single();
  if (profile) {
    brand = profile;
  } else {
    const { data: invitation } = await supabase.from("brand_invitations").select("*").eq("id", id).single();
    if (invitation) {
      brand = { brand_id: invitation.id, brand_name: invitation.brand_name, instagram_username: invitation.instagram_username, logo_url: invitation.logo_url, created_at: invitation.created_at, status: "invited", verification_status: "awaiting_claim", notes: invitation.notes };
      isInvited = true;
    }
  }

  if (!brand) return notFound();

  const [superAdmin, canWrite] = await Promise.all([isSuperAdmin(), isAdminOrAbove()]);

  // Fetch campaigns for this brand (from brand_id or brand_invitation_id)
  let campQuery = supabase
    .from("campaigns")
    .select("campaign_id, title, status, campaign_type, max_influencers, campaign_start_date, campaign_end_date, target_categories, budget_total, created_by_admin")
    .order("created_at", { ascending: false });

  if (isInvited) {
    campQuery = campQuery.eq("brand_invitation_id", id);
  } else {
    campQuery = campQuery.or(`brand_id.eq.${id},brand_invitation_id.eq.${id}`);
  }

  if (filterStatus) campQuery = campQuery.eq("status", filterStatus);

  const { data: campaigns } = await campQuery;

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  const statusBadge = (s: string) => {
    const c: Record<string, string> = {
      draft: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
      active: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
      paused: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
      completed: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    };
    return c[s] || c.draft;
  };

  const verificationConfig: Record<string, { bg: string; dot: string }> = {
    verified: { bg: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    rejected: { bg: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400", dot: "bg-red-500" },
    pending: { bg: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400", dot: "bg-yellow-500" },
    not_applied: { bg: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400", dot: "bg-gray-400" },
    awaiting_claim: { bg: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400", dot: "bg-amber-400 animate-pulse" },
  };
  const vs = verificationConfig[brand.verification_status] || verificationConfig.not_applied;

  // Parse invitation metadata
  let meta: any = null;
  if (isInvited && brand.notes) {
    try {
      const sep = brand.notes.indexOf("\n---\n");
      meta = JSON.parse(sep !== -1 ? brand.notes.slice(sep + 5) : (brand.notes.startsWith("{") ? brand.notes : ""));
    } catch {}
  }

  const campaignCounts = {
    all: campaigns?.length || 0,
    draft: campaigns?.filter((c: any) => c.status === "draft").length || 0,
    active: campaigns?.filter((c: any) => c.status === "active").length || 0,
    completed: campaigns?.filter((c: any) => c.status === "completed").length || 0,
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/brands" className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div className="flex items-center gap-4">
            {brand.logo_url ? (
              <img src={brand.logo_url} alt="" className="w-16 h-16 rounded-2xl object-cover border-2 border-white dark:border-gray-800 shadow-lg" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg">
                <span className="text-xl font-bold text-white">{brand.brand_name?.[0]?.toUpperCase() || "?"}</span>
              </div>
            )}
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{brand.brand_name || "Unknown"}</h1>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${vs.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${vs.dot}`} />
                  {isInvited ? "Invited" : (brand.verification_status || "not_applied")}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {brand.instagram_username && <span className="text-sm text-gray-500 dark:text-gray-400">@{brand.instagram_username}</span>}
                {brand.contact_name && !isInvited && (<><span className="text-gray-300 dark:text-gray-700">|</span><span className="text-sm text-gray-400 dark:text-gray-500">{brand.contact_name}</span></>)}
                {meta?.category && (<><span className="text-gray-300 dark:text-gray-700">|</span><span className="text-sm text-gray-400 dark:text-gray-500">{meta.category}</span></>)}
                <span className="text-gray-300 dark:text-gray-700">|</span>
                <span className="text-sm text-gray-400 dark:text-gray-500">{formatDate(brand.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isInvited && canWrite && <EditBrandButton brand={brand} />}
          {!isInvited && superAdmin && (
            <DeleteBrandButton
              brandId={brand.brand_id}
              displayName={brand.brand_name || brand.instagram_username || "Brand"}
              confirmText={brand.instagram_username || brand.brand_name || "DELETE"}
            />
          )}
          <RefreshButton />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Campaigns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Campaign Stats */}
          <div className="grid grid-cols-4 gap-3">
            {([["All", "all", campaignCounts.all, ""], ["Draft", "draft", campaignCounts.draft, "draft"], ["Active", "active", campaignCounts.active, "active"], ["Completed", "completed", campaignCounts.completed, "completed"]] as const).map(([label, key, count, val]) => (
              <a key={key} href={`/dashboard/brands/${id}${val ? `?status=${val}` : ""}`}
                className={`rounded-2xl p-4 text-center transition-all ${filterStatus === val || (!filterStatus && !val) ? "bg-indigo-50 dark:bg-indigo-900/20 border-2 border-indigo-200 dark:border-indigo-800" : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-indigo-200 dark:hover:border-indigo-800"}`}>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{count}</p>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">{label}</p>
              </a>
            ))}
          </div>

          {/* Campaign List */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Campaigns</h2>
              <Link href="/dashboard/campaigns/create" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 transition-colors">
                + New Campaign
              </Link>
            </div>
            {campaigns && campaigns.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {campaigns.map((c: any) => (
                  <Link key={c.campaign_id} href={`/dashboard/campaigns/${c.campaign_id}`} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">{c.title}</p>
                        {c.created_by_admin && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-semibold shrink-0">Admin</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-400">{c.campaign_type}</span>
                        <span className="text-xs text-gray-400">{formatDate(c.campaign_start_date)} — {formatDate(c.campaign_end_date)}</span>
                        {c.budget_total > 0 && <span className="text-xs text-gray-400">₹{c.budget_total?.toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${statusBadge(c.status)}`}>{c.status}</span>
                      <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-gray-400 dark:text-gray-500">No campaigns found</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create one from the Campaigns page</p>
              </div>
            )}
          </div>
        </div>

        {/* Right — Sidebar */}
        <div className="space-y-6">
          {/* Overview */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Overview</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <Row label="Status" value={isInvited ? "Invited" : (brand.status || "—")} />
              <Row label="Verification" value={isInvited ? "Awaiting Claim" : (brand.verification_status || "—")} />
              {!isInvited && <Row label="Tier" value={brand.tier || "—"} />}
              {!isInvited && <Row label="Listing" value={brand.listing_type || "—"} />}
              {!isInvited && <Row label="Source" value={brand.source || "—"} />}
              {!isInvited && <Row label="Completion" value={brand.profile_completion ? `${brand.profile_completion}%` : "—"} />}
              {meta?.category && <Row label="Category" value={meta.category} />}
              {meta?.instagram_verified && <Row label="IG Verified" value="Yes" />}
            </div>
          </div>

          {/* Contact — only for registered brands */}
          {!isInvited && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Contact</h2>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                <Row label="Name" value={brand.contact_name || "—"} />
                <Row label="Email" value={brand.contact_email || "—"} />
                <Row label="Phone" value={brand.contact_phone || "—"} />
                <Row label="Website" value={brand.website_url || "—"} />
              </div>
            </div>
          )}

          {/* GSTIN — only for registered brands */}
          {!isInvited && brand.gstin && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">GSTIN</h2>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                <Row label="GSTIN" value={brand.gstin} />
                <Row label="Legal Name" value={brand.gstin_legal_name || "—"} />
                <Row label="Trade Name" value={brand.gstin_trade_name || "—"} />
                <Row label="State" value={brand.gstin_state || "—"} />
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Timeline</h2>
            </div>
            <div className="p-5 space-y-3">
              <DateRow label="Created" date={formatDate(brand.created_at)} />
              {brand.updated_at && <DateRow label="Updated" date={formatDate(brand.updated_at)} />}
            </div>
          </div>

          {/* Raw data */}
          <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <summary className="px-6 py-4 text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">Raw Data</summary>
            <div className="px-6 pb-6"><pre className="text-xs text-gray-500 overflow-auto whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded-xl p-4">{JSON.stringify(brand, null, 2)}</pre></div>
          </details>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-6 py-3.5">
      <span className="text-[13px] text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-[13px] font-semibold text-gray-900 dark:text-white text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}

function DateRow({ label, date }: { label: string; date: string }) {
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
