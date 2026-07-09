import Link from "next/link";
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

export default async function CreatorStoriesPage() {
  const admin = createAdminClient();
  const { data: stories, error } = await admin
    .from("creator_stories")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: false });
  const canWrite = await isAdminOrAbove();
  const sectionTitle = await getCreatorStoriesSectionTitle();

  const activeCount = (stories || []).filter((s) => s.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Creator Stories</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Vertical reels shown in the Top Creator Stories carousel on the brand home page.
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
            New story
          </Link>
        )}
      </div>

      <CreatorStoriesSectionTitleEditor initialTitle={sectionTitle} canWrite={canWrite} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatPill label="Total" value={(stories || []).length} />
        <StatPill label="Active" value={activeCount} accent="text-emerald-600" />
        <StatPill label="Hidden" value={(stories || []).length - activeCount} accent="text-gray-400" />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(stories || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            No stories yet. Click <span className="font-semibold text-indigo-500">New story</span> to upload one.
            <p className="text-[11px] text-gray-300 mt-2">Until you publish at least one, the brand home page falls back to a built-in list.</p>
          </div>
        ) : (
          (stories || []).map((s) => <StoryRow key={s.id} story={s} canWrite={canWrite} />)
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

function StoryRow({ story, canWrite }: { story: any; canWrite: boolean }) {
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
          <span className="text-[10px] text-gray-400">no preview</span>
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

      {canWrite && (
        <>
          <form
            action={async () => {
              "use server";
              await moveCreatorStory(story.id, "up");
            }}
          >
            <ActionButton
              title="Move up"
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
              title="Move down"
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
        {story.is_active ? "Active" : "Hidden"}
      </span>

      {canWrite && (
        <>
          <Link
            href={`/dashboard/creator-stories/${story.id}/edit`}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Edit
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
              {story.is_active ? "Hide" : "Show"}
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
              Delete
            </ActionButton>
          </form>
        </>
      )}
    </div>
  );
}
