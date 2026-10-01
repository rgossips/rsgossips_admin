"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatStatus } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import { InstagramLink } from "@/components/instagram-link";
import type { IgStatus } from "@/lib/instagram-status";
import { ListCard } from "@/components/mobile/list-card";

const IG_STATUS_STYLE: Record<IgStatus, string> = {
  authorized: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  insights_denied: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  reconnect: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  not_connected: "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
};
const IG_STATUS_DOT: Record<IgStatus, string> = {
  authorized: "bg-emerald-500",
  insights_denied: "bg-amber-500",
  reconnect: "bg-red-500",
  not_connected: "bg-gray-400",
};

interface Influencer {
  influencer_id: string;
  full_name: string | null;
  username: string | null;
  instagram_handle?: string | null;
  profile_photo_url: string | null;
  followers_count: number | null;
  categories: string[] | null;
  status: string | null;
  media_kit_published?: boolean | null;
  igStatus: IgStatus;
}

// Same rule as the consumer app's brand-side cards: /kit/<handle> 404s
// unless the creator has published their kit.
function mediaKitUrlOf(inf: Influencer) {
  const handle = inf.instagram_handle || inf.username;
  return inf.media_kit_published && handle ? `https://rgossips.com/kit/${encodeURIComponent(handle)}` : null;
}

// Phone-width twin of InfluencerRow. A seven-column table is unreadable on a
// phone, so the same fields stack into a card; both live in this file so a
// change to one is a change in front of the other.
export function InfluencerCard({ inf, phone }: { inf: Influencer; phone?: string | null }) {
  const t = useTranslations("DashboardInfluencersInfluencerRow");
  const tIg = useTranslations("DashboardInfluencers.igStatus");
  const mediaKitUrl = mediaKitUrlOf(inf);
  const status = inf.status;

  return (
    <ListCard
      href={`/dashboard/influencers/${inf.influencer_id}`}
      leading={<Avatar src={inf.profile_photo_url} name={inf.full_name} size="sm" shape="circle" />}
      title={inf.full_name || "—"}
      subtitle={inf.instagram_handle || inf.username ? `@${inf.instagram_handle || inf.username}` : undefined}
      badges={
        <>
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
              status === "active"
                ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                : status === "suspended"
                ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                : status === "pending_deletion"
                ? "bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"
                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
            }`}
          >
            {formatStatus(status, t("unknown"))}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${IG_STATUS_STYLE[inf.igStatus]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${IG_STATUS_DOT[inf.igStatus]}`} />
            {tIg(inf.igStatus)}
          </span>
          {mediaKitUrl && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300">
              {t("viewMediaKit")}
            </span>
          )}
        </>
      }
      facts={[
        { label: t("followersLabel"), value: inf.followers_count?.toLocaleString() ?? "—" },
        {
          label: t("phoneLabel"),
          // tel: stays tappable — the one thing an admin genuinely does from
          // a phone. It sits outside the card's Link via ListCard's actions
          // slot? No: a nested anchor would be invalid, so show it as text
          // and let the detail page own the call action.
          value: phone ? (phone.startsWith("+") ? phone : `+${phone}`) : "—",
        },
        ...(inf.categories && inf.categories.length > 0
          ? [{ label: t("categoriesLabel"), value: inf.categories.slice(0, 3).join(", ") + (inf.categories.length > 3 ? ` +${inf.categories.length - 3}` : "") }]
          : []),
      ]}
    />
  );
}

export function InfluencerRow({ inf, phone }: { inf: Influencer; phone?: string | null }) {
  const t = useTranslations("DashboardInfluencersInfluencerRow");
  const tIg = useTranslations("DashboardInfluencers.igStatus");
  const status = inf.status;
  const mediaKitUrl = mediaKitUrlOf(inf);

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/influencers/${inf.influencer_id}`}
            className="flex items-center gap-3 group"
          >
            <Avatar src={inf.profile_photo_url} name={inf.full_name} size="sm" shape="circle" />
            <span className="text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              {inf.full_name || "—"}
            </span>
          </Link>
          {/* Sibling, not nested — an <a> inside the row's <Link> is invalid HTML. */}
          {mediaKitUrl && (
            <a
              href={mediaKitUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={t("viewMediaKit")}
              aria-label={t("viewMediaKit")}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-purple-50 text-purple-600 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </a>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        {/* username mirrors the IG handle for every profile; prefer the handle
            as the link target in case they ever diverge. */}
        <InstagramLink handle={inf.instagram_handle || inf.username} showAt={false} />
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 font-mono">
        {phone ? (
          <a href={`tel:${phone}`} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
            {phone.startsWith("+") ? phone : `+${phone}`}
          </a>
        ) : (
          <span className="text-gray-400 dark:text-gray-600">—</span>
        )}
      </td>
      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
        {inf.followers_count?.toLocaleString() ?? "—"}
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-1">
          {inf.categories && inf.categories.length > 0 ? (
            inf.categories.slice(0, 3).map((cat) => (
              <span
                key={cat}
                className="inline-flex px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              >
                {cat}
              </span>
            ))
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
          {inf.categories && inf.categories.length > 3 && (
            <span className="text-xs text-gray-400">+{inf.categories.length - 3}</span>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <span
          className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
            status === "active"
              ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
              : status === "suspended"
              ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
              : status === "pending_deletion"
              ? "bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"
              : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
          }`}
        >
          {formatStatus(status, t("unknown"))}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium ${IG_STATUS_STYLE[inf.igStatus]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${IG_STATUS_DOT[inf.igStatus]}`} />
          {tIg(inf.igStatus)}
        </span>
      </td>
    </tr>
  );
}
