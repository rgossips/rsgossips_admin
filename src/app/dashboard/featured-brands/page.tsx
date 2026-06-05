import { createAdminClient } from "@/utils/supabase/admin";
import {
  deleteFeaturedBrand,
  moveFeaturedBrand,
  toggleFeaturedBrandActive,
} from "./actions";
import { AddFeaturedBrandButton } from "./_components/add-featured-brand";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export const dynamic = "force-dynamic";

export default async function FeaturedBrandsPage() {
  const admin = createAdminClient();
  const { data: brands, error } = await admin
    .from("featured_brands")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: false });
  const canWrite = await isAdminOrAbove();

  const activeCount = (brands || []).filter((b) => b.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Featured Brands</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Hand-picked "Brands You'll Love" carousel on the influencer home page. Lower position = appears first.
          </p>
        </div>
        {canWrite && <AddFeaturedBrandButton />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatPill label="Total" value={(brands || []).length} />
        <StatPill label="Active" value={activeCount} accent="text-emerald-600" />
        <StatPill label="Hidden" value={(brands || []).length - activeCount} accent="text-gray-400" />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(brands || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            No featured brands yet. Click <span className="font-semibold text-indigo-500">Feature a brand</span> to add one.
            <p className="text-[11px] text-gray-300 mt-2">Until you publish at least one, the influencer home falls back to the full brand directory.</p>
          </div>
        ) : (
          (brands || []).map((b) => <BrandRow key={b.id} brand={b} canWrite={canWrite} />)
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

function BrandRow({ brand, canWrite }: { brand: any; canWrite: boolean }) {
  return (
    <div className="flex items-center gap-4 p-4">
      <span className="shrink-0 text-[11px] font-bold text-gray-500 dark:text-gray-400 w-6 text-center">
        {brand.position}
      </span>

      {brand.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logo_url} alt={brand.name} className="w-12 h-12 rounded-xl object-cover" />
      ) : (
        <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">
          {(brand.name || "?").charAt(0).toUpperCase()}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{brand.name}</p>
        {brand.instagram_url ? (
          <a
            href={brand.instagram_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-indigo-500 hover:underline truncate inline-block"
          >
            {brand.instagram_url}
          </a>
        ) : (
          <p className="text-[11px] text-gray-400">No Instagram link</p>
        )}
      </div>

      {canWrite && (
        <>
          <form
            action={async () => {
              "use server";
              await moveFeaturedBrand(brand.id, "up");
            }}
          >
            <button
              type="submit"
              title="Move up"
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              ↑
            </button>
          </form>
          <form
            action={async () => {
              "use server";
              await moveFeaturedBrand(brand.id, "down");
            }}
          >
            <button
              type="submit"
              title="Move down"
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              ↓
            </button>
          </form>
        </>
      )}

      <span
        className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
          brand.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
        }`}
      >
        {brand.is_active ? "Active" : "Hidden"}
      </span>

      {canWrite && (
        <>
          <form
            action={async () => {
              "use server";
              await toggleFeaturedBrandActive(brand.id, !brand.is_active);
            }}
          >
            <button
              type="submit"
              className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              {brand.is_active ? "Hide" : "Show"}
            </button>
          </form>

          <form
            action={async () => {
              "use server";
              await deleteFeaturedBrand(brand.id);
            }}
          >
            <button
              type="submit"
              className="shrink-0 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-[12px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer"
            >
              Delete
            </button>
          </form>
        </>
      )}
    </div>
  );
}
