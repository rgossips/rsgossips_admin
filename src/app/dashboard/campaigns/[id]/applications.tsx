"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateApplicationStatus } from "../actions";
import { ButtonSpinner } from "@/components/spinner";

interface Application {
  id: string;
  campaign_id: string;
  influencer_id: string;
  initiated_by: string;
  proposed_rate: number | null;
  brand_offered_rate: number | null;
  final_agreed_rate: number | null;
  status: string;
  rejection_reason: string | null;
  submission_links: Array<{ url: string; type: string; label: string }> | null;
  created_at: string;
  influencer_profiles: {
    full_name: string | null;
    username: string | null;
    profile_photo_url: string | null;
    followers_count: number | null;
    instagram_handle: string | null;
    categories: string[] | null;
    bio: string | null;
    engagement_rate: number | null;
    email: string | null;
    media_kit_published: boolean | null;
  } | null;
}

const statusConfig: Record<string, { bg: string; label: string }> = {
  pending: { bg: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400", label: "Pending Review" },
  approved: { bg: "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400", label: "Waiting for Submission" },
  submitted: { bg: "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400", label: "Submitted — Review Deliverables" },
  revision_needed: { bg: "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400", label: "Revision Needed" },
  accepted: { bg: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400", label: "Accepted" },
  live_submitted: { bg: "bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400", label: "Live Links Submitted" },
  payment: { bg: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400", label: "Payment Processing" },
  completed: { bg: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400", label: "Completed" },
  rejected: { bg: "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400", label: "Rejected" },
  withdrawn: { bg: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400", label: "Withdrawn" },
};

function formatCount(n: number | null) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function ApplicationsList({ applications, budgetPerInfluencer }: { applications: Application[]; budgetPerInfluencer: number }) {
  if (!applications || applications.length === 0) return null;

  const pending = applications.filter((a) => a.status === "pending").length;
  const approved = applications.filter((a) => a.status === "approved" || a.status === "accepted").length;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Applications</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">{applications.length}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {pending > 0 && <span className="text-amber-600 dark:text-amber-400 font-semibold">{pending} pending</span>}
          {approved > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{approved} approved</span>}
        </div>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {applications.map((app) => (
          <ApplicationRow key={app.id} application={app} budgetPerInfluencer={budgetPerInfluencer} />
        ))}
      </div>
    </div>
  );
}

function ApplicationRow({ application, budgetPerInfluencer }: { application: Application; budgetPerInfluencer: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [reason, setReason] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionIndexes, setRevisionIndexes] = useState<number[]>([]);
  const [payAmount, setPayAmount] = useState(String(application.proposed_rate || budgetPerInfluencer || 0));
  const [payNote, setPayNote] = useState("");
  const inf = application.influencer_profiles;
  const st = statusConfig[application.status] || statusConfig.pending;

  const handleAction = async (newStatus: string) => {
    setLoading(true);
    const result = await updateApplicationStatus(application.id, newStatus);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
  };

  const handleRevision = async () => {
    if (revisionIndexes.length === 0) { alert("Please select at least one deliverable that needs revision."); return; }
    const links = application.submission_links || [];
    const selectedLabels = revisionIndexes.map((i) => links[i]?.label || links[i]?.type || `Deliverable ${i + 1}`);
    setLoading(true);
    const result = await updateApplicationStatus(application.id, "revision_needed", undefined, undefined, undefined, revisionNote, selectedLabels);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
    setShowRevision(false);
  };

  const toggleRevisionIndex = (idx: number) => {
    setRevisionIndexes((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
  };

  const handleApprove = async () => {
    setLoading(true);
    const result = await updateApplicationStatus(application.id, "approved", undefined, payAmount ? parseInt(payAmount) : undefined, payNote || undefined);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
    setShowReview(false);
  };

  const handleReject = async () => {
    setLoading(true);
    const result = await updateApplicationStatus(application.id, "rejected", reason || undefined);
    if (result.error) alert(result.error);
    else router.refresh();
    setLoading(false);
    setShowReject(false);
  };

  const btnBase = "inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border";

  return (
    <div className="px-6 py-4">
      {/* Summary Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/dashboard/influencers/${application.influencer_id}`}>
            {inf?.profile_photo_url ? (
              <img src={inf.profile_photo_url} alt="" className="w-10 h-10 rounded-xl object-cover border border-gray-200 dark:border-gray-700 hover:border-indigo-400 transition-colors" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                <span className="text-sm font-bold text-white">{inf?.full_name?.[0]?.toUpperCase() || "?"}</span>
              </div>
            )}
          </Link>
          <div className="min-w-0">
            <Link href={`/dashboard/influencers/${application.influencer_id}`} className="text-sm font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors truncate block">
              {inf?.full_name || "Unknown"}
            </Link>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {inf?.instagram_handle && <span className="text-xs text-gray-400">@{inf.instagram_handle}</span>}
              <span className="text-xs text-gray-400">{formatCount(inf?.followers_count ?? null)} followers</span>
              {inf?.engagement_rate != null && <span className="text-xs text-gray-400">{inf.engagement_rate}% ER</span>}
              {application.proposed_rate != null && <span className="text-xs font-semibold text-indigo-500">Proposed ₹{application.proposed_rate.toLocaleString()}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {application.final_agreed_rate != null && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mr-1">₹{application.final_agreed_rate.toLocaleString()}</span>
          )}
          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${st.bg}`}>{st.label}</span>

          {application.status === "pending" && (
            <div className="flex items-center gap-1.5 ml-2">
              <button onClick={() => { setShowReview(!showReview); setShowReject(false); }} disabled={loading}
                className={`${btnBase} bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Review & Approve
              </button>
              <button onClick={() => { setShowReject(!showReject); setShowReview(false); }} disabled={loading}
                className={`${btnBase} bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                Reject
              </button>
            </div>
          )}

          {application.status === "approved" && (
            <button onClick={() => { setShowReject(!showReject); }} disabled={loading}
              className={`${btnBase} ml-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Reject
            </button>
          )}

          {application.status === "revision_needed" && (
            <button onClick={() => { setShowReject(!showReject); }} disabled={loading}
              className={`${btnBase} ml-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Reject
            </button>
          )}
        </div>
      </div>

      {/* ====== REVIEW PANEL ====== */}
      {showReview && application.status === "pending" && (
        <div className="mt-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden">
          {/* Section 1: Submitted Profile (mirrors the RGossips apply form) */}
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Submitted Profile</h4>
              <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">Auto-filled from influencer</span>
            </div>

            {/* Profile fields — same layout as ApplyCampaignForm */}
            <div className="space-y-2">
              <ProfileField icon="user" label="Full Name" value={inf?.full_name || "Not set"} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ProfileField icon="mail" label="Email" value={inf?.email || "Not set"} />
                <ProfileField icon="phone" label="Phone" value="(from auth)" />
              </div>
              <ProfileField icon="instagram" label="Instagram" value={inf?.instagram_handle ? `@${inf.instagram_handle}` : "Not connected"} />
              <div className="grid grid-cols-2 gap-2">
                <ProfileField icon="users" label="Followers" value={formatCount(inf?.followers_count ?? null)} />
                <ProfileField icon="activity" label="Engagement Rate" value={inf?.engagement_rate ? `${inf.engagement_rate}%` : "—"} />
              </div>
            </div>

            {/* Media Kit */}
            {inf?.media_kit_published && inf?.instagram_handle && (
              <a href={`https://rgossips.com/kit/${inf.instagram_handle}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 border border-purple-100 dark:border-purple-900/30 bg-purple-50/50 dark:bg-purple-900/10 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors group">
                <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 group-hover:scale-105 transition-transform">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">View Media Kit</p>
                  <p className="text-[10px] text-gray-400 truncate">rgossips.com/kit/{inf.instagram_handle}</p>
                </div>
                <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">Published</span>
              </a>
            )}

            {/* Categories */}
            {inf?.categories && inf.categories.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Categories</p>
                <div className="flex flex-wrap gap-1">
                  {inf.categories.map((cat) => (
                    <span key={cat} className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold">{cat}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Bio */}
            {inf?.bio && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Bio</p>
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{inf.bio}</p>
              </div>
            )}
          </div>

          {/* Section 2: Proposed Rate */}
          <div className="px-5 pb-4">
            <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Influencer&apos;s Proposed Rate</h4>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {application.proposed_rate ? `₹${application.proposed_rate.toLocaleString()}` : "Not specified"}
              </p>
              {budgetPerInfluencer > 0 && (
                <p className="text-[11px] text-gray-400 mt-1">Campaign budget per influencer: ₹{budgetPerInfluencer.toLocaleString()}</p>
              )}
            </div>
          </div>

          {/* Section 3: Admin Payment Decision */}
          <div className="px-5 pb-4 space-y-3">
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Your Payment Decision</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Approved Amount (₹)</label>
                  <input type="number" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Note (optional)</label>
                  <input type="text" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. Great profile, approved for Reels"
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Escrow Info */}
          <div className="px-5 pb-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div className="text-[12px] text-blue-700 dark:text-blue-300 leading-relaxed">
                <p className="font-semibold mb-1">Escrow Payment</p>
                <ul className="space-y-0.5 text-blue-600 dark:text-blue-400">
                  <li>This amount will be held by RecentGossips as escrow.</li>
                  <li>Payment will only be transferred to the influencer once the deliverables are completed to satisfaction.</li>
                  <li>If the application is rejected at any stage, the full amount will be refunded.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 px-5 pb-5">
            <button onClick={handleApprove} disabled={loading || !payAmount || parseInt(payAmount) <= 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors">
              {loading ? <ButtonSpinner /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
              {loading ? "Processing..." : `Approve & Hold ₹${parseInt(payAmount || "0").toLocaleString()}`}
            </button>
            <button onClick={() => setShowReview(false)} className="px-5 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ====== SUBMISSION REVIEW (when influencer submits deliverables) ====== */}
      {application.submission_links && application.submission_links.length > 0 && ["submitted", "revision_needed", "accepted", "live_submitted", "payment", "completed"].includes(application.status) && (
        <div className="mt-4 bg-purple-50/50 dark:bg-purple-900/10 rounded-2xl border border-purple-100 dark:border-purple-900/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-purple-100 dark:border-purple-800/30 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-900 dark:text-white">{application.status === "live_submitted" ? "Live Links for Review" : "Deliverable Links"}</h4>
              <p className="text-[10px] text-gray-400">{application.submission_links.length} link{application.submission_links.length > 1 ? "s" : ""} {application.status === "live_submitted" ? "posted live" : "submitted"} by influencer</p>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {application.submission_links.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 transition-colors group">
                <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center text-purple-500 group-hover:scale-105 transition-transform shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors capitalize">{item.label || item.type || `Deliverable ${i + 1}`}</p>
                  <p className="text-[10px] text-gray-400 truncate">{item.url}</p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold capitalize shrink-0">{item.type}</span>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </a>
            ))}
          </div>

          {/* Submitted: Accept / Need Revision / Reject */}
          {application.status === "submitted" && !showRevision && (
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <button onClick={() => handleAction("accepted")} disabled={loading}
                className={`${btnBase} bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100`}>
                {loading ? <ButtonSpinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                Accept Deliverables
              </button>
              <button onClick={() => { setShowRevision(true); setShowReject(false); }} disabled={loading}
                className={`${btnBase} bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Need Revision
              </button>
              <button onClick={() => { setShowReject(true); setShowRevision(false); }} disabled={loading}
                className={`${btnBase} bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                Reject
              </button>
            </div>
          )}

          {/* Live Links Submitted: Release Payment / Need Revision / Reject */}
          {application.status === "live_submitted" && !showRevision && (
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <button onClick={() => handleAction("payment")} disabled={loading}
                className={`${btnBase} bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100`}>
                {loading ? <ButtonSpinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                Release Payment
              </button>
              <button onClick={() => { setShowRevision(true); setShowReject(false); }} disabled={loading}
                className={`${btnBase} bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Need Revision
              </button>
            </div>
          )}

          {/* Payment: Initiate Payment */}
          {application.status === "payment" && (
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              <button onClick={() => handleAction("completed")} disabled={loading}
                className={`${btnBase} bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100`}>
                {loading ? <ButtonSpinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                Mark as Completed
              </button>
            </div>
          )}

          {/* Revision Selection Panel */}
          {showRevision && ["submitted", "live_submitted"].includes(application.status) && application.submission_links && (
            <div className="px-4 pb-4 space-y-3">
              <div className="p-4 bg-orange-50 dark:bg-orange-900/10 rounded-xl border border-orange-100 dark:border-orange-900/30 space-y-3">
                <h4 className="text-xs font-semibold text-orange-700 dark:text-orange-300">Select deliverables that need revision:</h4>
                <div className="space-y-2">
                  {application.submission_links.map((item, i) => {
                    const selected = revisionIndexes.includes(i);
                    return (
                      <button key={i} type="button" onClick={() => toggleRevisionIndex(i)}
                        className={`flex items-center gap-3 w-full p-3 rounded-xl text-left transition-all cursor-pointer border ${
                          selected
                            ? "bg-orange-100 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700"
                            : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-orange-200 dark:hover:border-orange-800"
                        }`}>
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                          selected ? "bg-orange-500 border-orange-500" : "border-gray-300 dark:border-gray-600"
                        }`}>
                          {selected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 capitalize">{item.label || item.type}</p>
                          <p className="text-[10px] text-gray-400 truncate">{item.url}</p>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 font-semibold capitalize shrink-0">{item.type}</span>
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-orange-700 dark:text-orange-300 mb-1.5">Revision Note</label>
                  <textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} rows={2}
                    placeholder="Explain what needs to be changed..."
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleRevision} disabled={loading || revisionIndexes.length === 0}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:bg-orange-300 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors">
                    {loading ? <ButtonSpinner /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                    Send for Revision ({revisionIndexes.length} selected)
                  </button>
                  <button onClick={() => { setShowRevision(false); setRevisionIndexes([]); setRevisionNote(""); }}
                    className="px-5 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reject Panel — works for all rejectable states */}
      {showReject && ["pending", "approved", "submitted", "revision_needed"].includes(application.status) && (
        <div className="mt-3 flex items-center gap-2">
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection (optional)"
            className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500" />
          <button onClick={handleReject} disabled={loading} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
            {loading ? <ButtonSpinner /> : "Confirm Reject"}
          </button>
          <button onClick={() => setShowReject(false)} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs cursor-pointer">Cancel</button>
        </div>
      )}

      {/* Revision details */}
      {application.status === "revision_needed" && application.rejection_reason && (() => {
        let revData: { note?: string; links?: string[] } = {};
        try { revData = JSON.parse(application.rejection_reason); } catch {}
        if (!revData.note && !revData.links?.length) return null;
        return (
          <div className="mt-3 p-4 rounded-xl bg-orange-50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/30 space-y-2">
            <h4 className="text-xs font-semibold text-orange-700 dark:text-orange-300 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Revision Requested
            </h4>
            {revData.note && <p className="text-xs text-orange-600 dark:text-orange-400">{revData.note}</p>}
            {revData.links && revData.links.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider">Links to revise:</p>
                {revData.links.map((url, i) => {
                  const match = application.submission_links?.find((s) => s.url === url);
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400">
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
                      <span className="font-semibold capitalize">{match?.label || match?.type || "Link"}</span>
                      <span className="text-orange-400 truncate">{url}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Escrow info for approved/submitted */}
      {["approved", "submitted", "revision_needed"].includes(application.status) && application.final_agreed_rate != null && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30">
          <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          <span className="text-xs text-indigo-700 dark:text-indigo-300">
            <span className="font-semibold">₹{application.final_agreed_rate.toLocaleString()}</span> held in escrow — will be released on acceptance
          </span>
        </div>
      )}

      {/* Accepted — waiting for live links */}
      {application.status === "accepted" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
          <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-xs text-emerald-700 dark:text-emerald-300">
            Deliverables accepted. Waiting for influencer to post live and submit links.
          </span>
        </div>
      )}

      {/* Live links submitted — review */}
      {application.status === "live_submitted" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-cyan-50 dark:bg-cyan-900/10 border border-cyan-100 dark:border-cyan-900/30">
          <svg className="w-4 h-4 text-cyan-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
          <span className="text-xs text-cyan-700 dark:text-cyan-300">
            Live links submitted. Verify posts are published and release payment.
          </span>
        </div>
      )}

      {/* Payment processing */}
      {application.status === "payment" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Payment released{application.final_agreed_rate ? ` — ₹${application.final_agreed_rate.toLocaleString()}` : ""}. Mark as completed after payment is transferred.
          </span>
        </div>
      )}

      {/* Rejection reason */}
      {application.rejection_reason && application.status === "rejected" && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
          <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-xs text-red-600 dark:text-red-400">Rejected: {application.rejection_reason}</span>
        </div>
      )}

      {/* Date */}
      <p className="text-[11px] text-gray-400 mt-1.5">
        Applied {new Date(application.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
      </p>
    </div>
  );
}

const iconPaths: Record<string, string> = {
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  mail: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  phone: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  instagram: "M16 4H8a4 4 0 00-4 4v8a4 4 0 004 4h8a4 4 0 004-4V8a4 4 0 00-4-4zm-4 11a3 3 0 110-6 3 3 0 010 6zm4.5-7.5a1 1 0 110-2 1 1 0 010 2z",
  users: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  activity: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
};

const iconColors: Record<string, string> = {
  user: "text-purple-500", mail: "text-pink-500", phone: "text-blue-500",
  instagram: "text-pink-500", users: "text-purple-500", activity: "text-emerald-500",
};

function ProfileField({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
      <svg className={`w-4 h-4 shrink-0 ${iconColors[icon] || "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPaths[icon] || ""} />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase">{label}</p>
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">{value}</p>
      </div>
    </div>
  );
}
