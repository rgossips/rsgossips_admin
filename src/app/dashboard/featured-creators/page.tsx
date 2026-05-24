import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { deleteFeaturedCreator, moveFeaturedCreator, toggleFeaturedCreatorActive } from "./actions";
import { ActionButton } from "./_components/action-button";

export const dynamic = "force-dynamic";

export default async function FeaturedCreatorsPage() {
  const admin = createAdminClient();
  const { data: creators, error } = await admin.from("featured_creators").select("*").order("position", { ascending: true }).order("created_at", { ascending: false });

  const activeCount = (creators || []).filter((c) => c.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Featured Creators</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Hand-curated Top Creators carousel on the brand home page. Lower position = appears first.</p>
        </div>
        <Link
          href="/dashboard/featured-creators/create"
          className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Feature a creator
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatPill label="Total" value={(creators || []).length} />
        <StatPill label="Active" value={activeCount} accent="text-emerald-600" />
        <StatPill label="Hidden" value={(creators || []).length - activeCount} accent="text-gray-400" />
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">{error.message}</div>}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(creators || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            No featured creators yet. Click <span className="font-semibold text-indigo-500">Feature a creator</span> to add one.
            <p className="text-[11px] text-gray-300 mt-2">Until you publish at least one, the brand home page falls back to a built-in list.</p>
          </div>
        ) : (
          (creators || []).map((c) => <CreatorRow key={c.id} creator={c} />)
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

function CreatorRow({ creator }: { creator: any }) {
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
          {creator.verified && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Verified</span>}
        </div>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
          @{creator.username} · {creator.followers_label || "?"} followers
          {creator.rating ? ` · ★ ${creator.rating}` : ""}
        </p>
        <a href={creator.instagram_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-500 hover:underline truncate inline-block">
          {creator.instagram_url}
        </a>
      </div>

      <form
        action={async () => {
          "use server";
          await moveFeaturedCreator(creator.id, "up");
        }}
      >
        <ActionButton title="Move up" className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
          ↑
        </ActionButton>
      </form>
      <form
        action={async () => {
          "use server";
          await moveFeaturedCreator(creator.id, "down");
        }}
      >
        <ActionButton title="Move down" className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
          ↓
        </ActionButton>
      </form>

      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${creator.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
        {creator.is_active ? "Active" : "Hidden"}
      </span>

      <Link
        href={`/dashboard/featured-creators/${creator.id}/edit`}
        className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Edit
      </Link>

      <form
        action={async () => {
          "use server";
          await toggleFeaturedCreatorActive(creator.id, !creator.is_active);
        }}
      >
        <ActionButton className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
          {creator.is_active ? "Hide" : "Show"}
        </ActionButton>
      </form>

      <form
        action={async () => {
          "use server";
          await deleteFeaturedCreator(creator.id);
        }}
      >
        <ActionButton className="shrink-0 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-[12px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer">
          Delete
        </ActionButton>
      </form>
    </div>
  );
}
