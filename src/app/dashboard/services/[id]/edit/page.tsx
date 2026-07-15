import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { ServiceForm } from "../../_form/service-form";
import { updateService } from "../../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminOrAbove())) redirect("/dashboard/services");
  const t = await getTranslations("DashboardServicesIdEdit");
  const { id } = await params;
  const admin = createAdminClient();
  const { data: service } = await admin.from("services").select("*").eq("id", id).maybeSingle();
  if (!service) notFound();

  // Bind the id into the action so the form just passes formData.
  const action = updateService.bind(null, id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/services"
          className="text-[12px] font-semibold text-indigo-600 hover:underline"
        >
          {t("backToServices")}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t("subtitle")}
        </p>
      </div>

      <ServiceForm initial={service} action={action} submitLabel={t("saveChanges")} />
    </div>
  );
}
