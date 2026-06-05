import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { CreatorStoryForm } from "../../_form/creator-story-form";
import { updateCreatorStory } from "../../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export const dynamic = "force-dynamic";

export default async function EditCreatorStoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminOrAbove())) redirect("/dashboard/creator-stories");
  const { id } = await params;
  const admin = createAdminClient();
  const { data: story } = await admin
    .from("creator_stories")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!story) notFound();

  const updateAction = async (formData: FormData) => {
    "use server";
    return updateCreatorStory(id, formData);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/creator-stories"
          className="text-[12px] font-semibold text-indigo-600 hover:underline"
        >
          ← Creator Stories
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit story</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Changes go live on the brand home page immediately.
        </p>
      </div>

      <CreatorStoryForm action={updateAction} initial={story} submitLabel="Save changes" />
    </div>
  );
}
