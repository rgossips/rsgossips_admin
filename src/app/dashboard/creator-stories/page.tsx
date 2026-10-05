import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SortMenu } from "@/components/sort-controls";
import { applySort, resolveSort, type SortOption } from "@/lib/sorting";

const BASE = "/dashboard/creator-stories";

// A curation list: `position` is hand-set with the up/down buttons and IS
// the order the consumer app renders, so it stays the default. The other
// options are for FINDING a row in a long list, not rearranging it — and
// while one is active the move buttons are hidden, because they would be
// shifting a position no longer on screen.
function creatorStorySorts(label: (k: string) => string): SortOption[] {
  const tiebreak = { column: "created_at", ascending: false };
  return [
    { key: "position", column: "position", label: label("position"), defaultDir: "asc", nullsLast: true, tiebreak },
    { key: "active", column: "is_active", label: label("active"), defaultDir: "desc", tiebreak },
    { key: "created", column: "created_at", label: label("created"), defaultDir: "desc" },
  ];
}
import { createAdminClient } from "@/utils/supabase/admin";
import {
  deleteCreatorStory,
  getCreatorStoriesSectionTitle,
  moveCreatorStory,
  toggleCreatorStoryActive,
} from "./actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { ActionButton } from "@/components/action-button";
import { CreatorStoriesSectionTitleEditor } from "./_components/section-title-editor";

export const dynamic = "force-dynamic";

export default async function CreatorStoriesPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string }>;
}) {
  const t = await getTranslations("DashboardCreatorStories");
  const sp = (await searchParams) || {};
  const SORTS = creatorStorySorts((k) => t(`sort.${k}`));
  // `position` is the fallback, so the page opens in the curated order it
  // had before sorting existed.
  const sort = resolveSort(sp.sort, SORTS, "position");
  const inDisplayOrder = sort.key === "position";
  const admin = createAdminClient();
  const { data: stories, error } = await applySort(
    admin.from("creator_stories").select("*"),
    sort,
  );
  const canWrite = await isAdminOrAbove();
  const sectionTitle = await getCreatorStoriesSectionTitle();

  const activeCount = (stories || []).filter((s) => s.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("subtitle")}
          </p>
        </div>
        {canWrite && (
          <Link
            href="/dashboard/creator-stories/create"
            className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("newStory")}
          </Link>
        )}
      </div>

      <CreatorStoriesSectionTitleEditor initialTitle={sectionTitle} canWrite={canWrite} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatPill label={t("stats.total")} value={(stories || []).length} />
        <StatPill label={t("stats.active")} value={activeCount} accent="text-emerald-600" />
        <StatPill label={t("stats.hidden")} value={(stories || []).length - activeCount} accent="text-gray-400" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SortMenu options={SORTS} current={sort} basePath={BASE} params={sp} />
        {!inDisplayOrder && (
          // Says out loud why the up/down buttons have gone, rather than
          // leaving the admin to wonder whether they broke it.
          <p className="text-[12px] text-amber-700 dark:text-amber-400">{t("sortNote")}</p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(stories || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            {t.rich("empty.line1", {
              emph: (c) => <span className="font-semibold text-indigo-500">{c}</span>,
            })}
            <p className="text-[11px] text-gray-300 mt-2">{t("empty.line2")}</p>
          </div>
        ) : (
          (stories || []).map((s) => (
            <StoryRow key={s.id} story={s} canWrite={canWrite} inDisplayOrder={inDisplayOrder} />
          ))
        )}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent || "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}

async function StoryRow({ story, canWrite, inDisplayOrder }: { story: any; canWrite: boolean; inDisplayOrder: boolean }) {
  const t = await getTranslations("DashboardCreatorStories");
  return (
    <div className="flex items-center gap-4 p-4">
      <span className="shrink-0 text-[11px] font-bold text-gray-500 dark:text-gray-400 w-6 text-center">
        {story.position}
      </span>

      <div className="shrink-0 w-12 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
        {story.poster_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.poster_url} alt="" className="w-full h-full object-cover" />
        ) : story.video_url ? (
          <video src={story.video_url} className="w-full h-full object-cover" muted preload="metadata" />
        ) : (
          <span className="text-[10px] text-gray-400">{t("noPreview")}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">@{story.username || "—"}</p>
        <a
          href={story.video_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-indigo-500 hover:underline truncate inline-block"
        >
          {story.video_url}
        </a>
      </div>

      {/* Reordering only makes sense while the list IS the display order.
          Sorted by anything else, "move up" would shift a position the
          admin cannot see, so the pair is hidden rather than lying. */}
      {canWrite && inDisplayOrder && (
        <>
          <form
            action={async () => {
              "use server";
              await moveCreatorStory(story.id, "up");
            }}
          >
            <ActionButton
              title={t("moveUp")}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              ↑
            </ActionButton>
          </form>
          <form
            action={async () => {
              "use server";
              await moveCreatorStory(story.id, "down");
            }}
          >
            <ActionButton
              title={t("moveDown")}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              ↓
            </ActionButton>
          </form>
        </>
      )}

      <span
        className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
          story.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
        }`}
      >
        {story.is_active ? t("statusActive") : t("statusHidden")}
      </span>

      {canWrite && (
        <>
          <Link
            href={`/dashboard/creator-stories/${story.id}/edit`}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {t("edit")}
          </Link>

          <form
            action={async () => {
              "use server";
              await toggleCreatorStoryActive(story.id, !story.is_active);
            }}
          >
            <ActionButton
              className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              {story.is_active ? t("hide") : t("show")}
            </ActionButton>
          </form>

          <form
            action={async () => {
              "use server";
              await deleteCreatorStory(story.id);
            }}
          >
            <ActionButton
              className="shrink-0 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-[12px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer"
            >
              {t("delete")}
            </ActionButton>
          </form>
        </>
      )}
    </div>
  );
}
