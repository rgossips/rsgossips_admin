import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { SweepPanel } from "./sweep-panel";

// Static segment, so it wins over [id] in the same folder.
export const dynamic = "force-dynamic";

export default async function CloseEndedCampaignsPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/campaigns");

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/dashboard/campaigns"
          className="rounded-xl p-2.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Close ended campaigns</h1>
          <p className="mt-0.5 text-sm text-gray-400 dark:text-gray-500">
            Campaigns past their end date, and the applicants still waiting on them.
          </p>
        </div>
      </div>

      <SweepPanel />
    </div>
  );
}
