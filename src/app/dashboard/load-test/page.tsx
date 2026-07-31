import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSuperAdmin } from "@/lib/require-super-admin";
import { LoadTestRunner } from "./_components/load-test-runner";
import { DesktopBestBanner } from "@/components/mobile/desktop-best-banner";
import { getScenarioCatalog } from "./actions";

export const dynamic = "force-dynamic";
// A full run (4 scenarios × 20 VUs × 20 iterations, sequential) can take
// a few minutes — raise the serverless limit so the action isn't killed
// mid-run on hosted deployments.
export const maxDuration = 300;

export default async function LoadTestPage() {
  // Page-level gate on top of the server-action gate — non-super-admins
  // shouldn't even see the tool.
  if (!(await isSuperAdmin())) redirect("/dashboard");

  const scenarios = await getScenarioCatalog();
  const t = await getTranslations("DashboardLoadTest");

  return (
    <div className="space-y-6">
      <DesktopBestBanner />
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t("description")}
        </p>
      </div>

      <LoadTestRunner scenarios={scenarios} />
    </div>
  );
}
