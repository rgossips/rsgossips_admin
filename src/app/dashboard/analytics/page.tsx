import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { getGaOverview } from "./ga-actions";
import { GaDashboard } from "./ga-dashboard";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  if (!(await isAdminOrAbove())) redirect("/dashboard");
  const { days } = await searchParams;
  const window = Number(days) || 30;
  const data = await getGaOverview(window);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Website analytics</h1>
        <p className="mt-0.5 text-sm text-gray-400 dark:text-gray-500">
          Active users and page visits from Google Analytics.
        </p>
      </div>
      <GaDashboard data={data} window={window} />
    </div>
  );
}
