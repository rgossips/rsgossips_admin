import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { deleteFeaturedCreator, moveFeaturedCreator, toggleFeaturedCreatorActive } from "./actions";
import { ActionButton } from "./_components/action-button";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { SortMenu } from "@/components/sort-controls";
import { applySort, resolveSort, type SortOption } from "@/lib/sorting";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/featured-creators";

// A curation list: `position` is hand-set with the ↑ / ↓ buttons and IS the
// order the consumer app renders, so it stays the default. The other
// options are for finding someone in a long list, not for rearranging it —
// and while one of them is active the move buttons are hidden, because they
// would be shifting a position that is no longer on screen.
function featuredCreatorSorts(label: (k: string) => string): SortOption[] {
  const tiebreak = { column: "created_at", ascending: false };
  return [
    { key: "position", column: "position", label: label("position"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "name", column: "display_name", label: label("name"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "active", column: "is_active", label: label("active"), defaultDir: "desc", tiebreak },
    { key: "rating", column: "rating", label: label("rating"), defaultDir: "desc", nullsLast: true, tiebreak },
    { key: "created", column: "created_at", label: label("created"), defaultDir: "desc" },
  ];
}

export default async function FeaturedCreatorsPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string }>;
}) {
  const t = await getTranslations("DashboardFeaturedCreators");
  const admin = createAdminClient();
  const sp = (await searchParams) || {};
  const SORTS = featuredCreatorSorts((k) => t(`sort.${k}`));
  // `position` is the fallback, so the page opens in the curated order it
  // had before sorting existed.
  const sort = resolveSort(sp.sort, SORTS, "position");
  const inDisplayOrder = sort.key === "position";

  const { data: creators, error } = await applySort(
    admin.from("featured_creators").select("*"),
    sort,
  );
  const canWrite = await isAdminOrAbove();

  const activeCount = (creators || []).filter((c) => c.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("description")}</p>
        </div>
        {canWrite && (
          <Link
            href="/dashboard/featured-creators/create"
            className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("featureCreator")}
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatPill label={t("stats.total")} value={(creators || []).length} />
        <StatPill label={t("stats.active")} value={activeCount} accent="text-emerald-600" />
        <StatPill label={t("stats.hidden")} value={(creators || []).length - activeCount} accent="text-gray-400" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SortMenu options={SORTS} current={sort} basePath={BASE} params={sp} />
        {!inDisplayOrder && (
          // Says out loud why the ↑ / ↓ buttons have gone, rather than
          // leaving the admin to wonder whether they broke.
          <p className="text-[12px] text-amber-700 dark:text-amber-400">
            {t("sortNote")}
          </p>
        )}
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">{error.message}</div>}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(creators || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            {t.rich("emptyState", {
              strong: (chunks) => <span className="font-semibold text-indigo-500">{chunks}</span>,
            })}
            <p className="text-[11px] text-gray-300 mt-2">{t("emptyFallbackNote")}</p>
          </div>
        ) : (
          (creators || []).map((c) => (
            <CreatorRow key={c.id} creator={c} canWrite={canWrite} inDisplayOrder={inDisplayOrder} />
          ))
        )}
      </div>
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent || "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}

async function CreatorRow({ creator, canWrite, inDisplayOrder }: { creator: any; canWrite: boolean; inDisplayOrder: boolean }) {
  const t = await getTranslations("DashboardFeaturedCreators");
  return (
    <div className="flex items-center gap-4 p-4">
      {/* <span className="shrink-0 text-[11px] font-bold text-gray-500 dark:text-gray-400 w-6 text-center">
        {creator.position}
      </span> */}

      {creator.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={creator.avatar_url} alt={creator.username} className="w-12 h-12 rounded-full object-cover" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">{(creator.username || "?").charAt(0).toUpperCase()}</div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{creator.display_name || `@${creator.username}`}</p>
          {creator.verified && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{t("verified")}</span>}
        </div>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
          {t("followersLine", { username: creator.username, followers: creator.followers_label || "?" })}
          {creator.rating ? t("ratingSuffix", { rating: creator.rating }) : ""}
        </p>
        <a href={creator.instagram_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-500 hover:underline truncate inline-block">
          {creator.instagram_url}
        </a>
      </div>

      {/* Reordering only makes sense while the list IS the display order.
          Sorted by name, "move up" would shuffle a position the admin
          cannot see, so the pair is hidden rather than lying. */}
      {canWrite && inDisplayOrder && (
        <>
          <form
            action={async () => {
              "use server";
              await moveFeaturedCreator(creator.id, "up");
            }}
          >
            <ActionButton title={t("moveUp")} className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              ↑
            </ActionButton>
          </form>
          <form
            action={async () => {
              "use server";
              await moveFeaturedCreator(creator.id, "down");
            }}
          >
            <ActionButton title={t("moveDown")} className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              ↓
            </ActionButton>
          </form>
        </>
      )}

      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${creator.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
        {creator.is_active ? t("statusActive") : t("statusHidden")}
      </span>

      {canWrite && (
        <>
          <Link
            href={`/dashboard/featured-creators/${creator.id}/edit`}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {t("edit")}
          </Link>

          <form
            action={async () => {
              "use server";
              await toggleFeaturedCreatorActive(creator.id, !creator.is_active);
            }}
          >
            <ActionButton className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              {creator.is_active ? t("hide") : t("show")}
            </ActionButton>
          </form>

          <form
            action={async () => {
              "use server";
              await deleteFeaturedCreator(creator.id);
            }}
          >
            <ActionButton className="shrink-0 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-[12px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer">
              {t("delete")}
            </ActionButton>
          </form>
        </>
      )}
    </div>
  );
}
