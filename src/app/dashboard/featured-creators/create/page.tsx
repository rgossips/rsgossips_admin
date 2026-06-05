import Link from "next/link";
import { redirect } from "next/navigation";
import { FeaturedCreatorForm } from "../_form/featured-creator-form";
import { createFeaturedCreator } from "../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export default async function CreateFeaturedCreatorPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/featured-creators");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/featured-creators"
          className="text-[12px] font-semibold text-indigo-600 hover:underline"
        >
          ← Featured Creators
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Feature a creator</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Curated row appears in the brand-side Top Creators carousel as soon as you publish.
        </p>
      </div>

      <FeaturedCreatorForm action={createFeaturedCreator} submitLabel="Publish" />
    </div>
  );
}
