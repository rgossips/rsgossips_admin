import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CreatorStoryForm } from "../_form/creator-story-form";
import { createCreatorStory } from "../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export default async function CreateCreatorStoryPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/creator-stories");
  const t = await getTranslations("DashboardCreatorStoriesCreate");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/creator-stories"
          className="text-[12px] font-semibold text-indigo-600 hover:underline"
        >
          {t("backToStories")}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t("subtitle")}
        </p>
      </div>

      <CreatorStoryForm action={createCreatorStory} submitLabel={t("submitLabel")} />
    </div>
  );
}
