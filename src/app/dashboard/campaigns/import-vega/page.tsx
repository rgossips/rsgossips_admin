import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import BackfillPanel from "./backfill-panel";

// One-off: recording seven finished Vega campaigns that were run on
// spreadsheets before the sourcing tab existed.
//
// A route rather than a script, for one reason: re-running it safely needs a
// human looking at a preview of what would change, against the live
// database. It also inherits requireAdmin, the rate limit and the audit log
// for free, and keeps the service-role key in Netlify env rather than a
// local .env.
//
// Nothing here is scheduled and nothing runs on load. A dry run reads; only
// pressing Import writes.

export const dynamic = "force-dynamic";

export default async function ImportVegaPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/campaigns");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <Link
          href="/dashboard/campaigns"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          &larr; Campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Import the Vega campaign sheets
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Seven Vega campaigns were run by hand on spreadsheets. This records who was on each one, how far they got and
          what they were paid, onto the campaigns that already exist.
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="font-semibold">Worth knowing before you start</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>Nobody is emailed or notified.</strong> These campaigns finished months ago, so the import writes
            directly and deliberately avoids the actions that would message a creator or a brand.
          </li>
          <li>
            <strong>Most of these creators have no account</strong>, so they can only appear in the admin Sourcing tab.
            Creators with an RGossips login also show up in the brand and creator apps; the rest are added to the
            creator database as invited creators so they are not lost again.
          </li>
          <li>
            <strong>Existing applications are left alone</strong>, except where a sheet row belongs to a registered
            creator whose application can move forward. Nothing is ever rejected or withdrawn by this import.
          </li>
          <li>
            <strong>It is safe to run twice.</strong> Rows this import wrote are refreshed from the sheet; a booking you
            built by hand in the portal is never overwritten.
          </li>
          <li>
            <strong>No payouts are created.</strong> The stages that queue money are unreachable here by design — the
            money in these sheets was settled offline.
          </li>
        </ul>
      </div>

      <BackfillPanel />
    </div>
  );
}
