import Link from "next/link";
import { InstagramLink } from "@/components/instagram-link";
import { APPLICATION_STATUS_BADGE } from "@/lib/application-status";

// The portal's half of the roster.
//
// Opening Sourcing should answer "who is on this campaign" — and on a
// campaign with both intake paths that is not just the people an admin
// typed in. These creators hold seats exactly like a booking does, which is
// why they appear here rather than only on the campaign's own tab.
//
// Read-only on purpose. An application is driven by the brand and the
// creator through their own flow: approving, requesting revisions and
// releasing payment all happen on the campaign page, and duplicating those
// controls here would be two places to get the same decision wrong.

type Applicant = {
  id: string;
  influencer_id: string;
  status: string;
  created_at: string;
  shipping_address: string | null;
  influencer_profiles: {
    full_name: string | null;
    username: string | null;
    instagram_handle: string | null;
    followers_count: number | null;
  } | null;
};

export function ApprovedApplicants({ applicants, campaignId }: { applicants: Applicant[]; campaignId: string }) {
  if (applicants.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">
          Approved through the portal <span className="font-normal text-gray-400">({applicants.length})</span>
        </h2>
        <Link
          href={`/dashboard/campaigns/${campaignId}`}
          className="text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Manage applications →
        </Link>
      </div>

      <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
        {applicants.map((a) => {
          const p = a.influencer_profiles;
          const handle = p?.instagram_handle || p?.username || "";
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/influencers/${a.influencer_id}`}
                  className="text-[13px] font-semibold text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                >
                  {p?.full_name || handle || "—"}
                </Link>
                <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-gray-500">
                  {handle && <InstagramLink handle={handle} />}
                  {p?.followers_count ? <span>{p.followers_count.toLocaleString("en-IN")} followers</span> : null}
                  {/* A barter campaign that ships collects this at apply
                      time; its absence is the thing to chase. */}
                  {a.shipping_address ? (
                    <span className="text-emerald-600 dark:text-emerald-400">address on file</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">no address</span>
                  )}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${APPLICATION_STATUS_BADGE[a.status] || "bg-gray-100 text-gray-600"}`}>
                {a.status.replace(/_/g, " ")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
