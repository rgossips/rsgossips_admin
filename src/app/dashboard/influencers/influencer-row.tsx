"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatStatus } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import { InstagramLink } from "@/components/instagram-link";
import type { IgStatus } from "@/lib/instagram-status";

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

export function InfluencerRow({ inf, phone }: { inf: Influencer; phone?: string | null }) {
  const t = useTranslations("DashboardInfluencersInfluencerRow");
  const tIg = useTranslations("DashboardInfluencers.igStatus");
  const status = inf.status;
  // Same rule as the consumer app's brand-side cards: /kit/<handle> 404s
  // unless the creator has published their kit.
  const kitHandle = inf.instagram_handle || inf.username;
  const mediaKitUrl =
    inf.media_kit_published && kitHandle ? `https://rgossips.com/kit/${encodeURIComponent(kitHandle)}` : null;

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
