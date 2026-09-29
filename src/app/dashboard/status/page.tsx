import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { StatusClient } from "./status-client";

export const dynamic = "force-dynamic";

// System status. Every check is on demand — see lib/status/targets.ts for why
// this page never polls. Admin-only: the results name our infrastructure and
// say which secrets are configured.
export default async function StatusPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">System status</h1>
        <p className="text-[12px] text-gray-500">
          Pings the database, the edge functions, both websites and the services we pay for. Read-only: no email,
          notification or payment can be triggered from here.
        </p>
      </div>

      <StatusClient />
    </div>
  );
}
