import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { FeaturedCreatorForm } from "../../_form/featured-creator-form";
import { updateFeaturedCreator } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditFeaturedCreatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: creator } = await admin
    .from("featured_creators")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!creator) notFound();

  // Bind the id so the form can call the server action with a single argument.
  const updateAction = async (formData: FormData) => {
    "use server";
    return updateFeaturedCreator(id, formData);
  };

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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit featured creator</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Changes go live on the brand home page immediately.
        </p>
      </div>

      <FeaturedCreatorForm action={updateAction} initial={creator} submitLabel="Save changes" />
    </div>
  );
}
