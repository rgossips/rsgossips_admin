import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/require-super-admin";
import { LoadTestRunner } from "./_components/load-test-runner";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Load Test</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Fires read-only requests at the live edge functions and reports latency percentiles.
          Runs from the admin server (service key never leaves it). Concurrency is hard-capped
          at 20 virtual users × 20 iterations per scenario — this is a smoke-level check against
          production, not a stress rig.
        </p>
      </div>

      <LoadTestRunner scenarios={scenarios} />
    </div>
  );
}
