import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { FeaturedCreatorForm } from "../../_form/featured-creator-form";
import { updateFeaturedCreator } from "../../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function EditFeaturedCreatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("DashboardFeaturedCreatorsIdEdit");
  if (!(await isAdminOrAbove())) redirect("/dashboard/featured-creators");
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
          {t("backToFeaturedCreators")}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t("subtitle")}
        </p>
      </div>

      <FeaturedCreatorForm action={updateAction} initial={creator} submitLabel={t("saveChanges")} />
    </div>
  );
}
