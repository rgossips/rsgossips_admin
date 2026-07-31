import Link from "next/link";
import { DesktopBestBanner } from "@/components/mobile/desktop-best-banner";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ServiceForm } from "../_form/service-form";
import { createService } from "../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export default async function CreateServicePage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/services");
  const t = await getTranslations("DashboardServicesCreate");
  return (
    <div className="space-y-6">
      <DesktopBestBanner />
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

      <ServiceForm action={createService} submitLabel={t("submitLabel")} />
    </div>
  );
}
