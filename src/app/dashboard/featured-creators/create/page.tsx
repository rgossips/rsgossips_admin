import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FeaturedCreatorForm } from "../_form/featured-creator-form";
import { createFeaturedCreator } from "../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export default async function CreateFeaturedCreatorPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/featured-creators");
  const t = await getTranslations("DashboardFeaturedCreatorsCreate");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/featured-creators"
          className="text-[12px] font-semibold text-indigo-600 hover:underline"
        >
          {t("backLink")}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t("subtitle")}
        </p>
      </div>

      <FeaturedCreatorForm action={createFeaturedCreator} submitLabel={t("submitLabel")} />
    </div>
  );
}
