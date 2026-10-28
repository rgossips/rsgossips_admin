import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { ScoutPanel } from "./scout-panel";

// Every action behind this page spends prepaid HikerAPI credit, so it is
// admin-only — a viewer must not be able to drain a balance the add-creator
// Fetch button and "Update missing details" also depend on.
export const dynamic = "force-dynamic";

export default async function ScoutingPage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Scout creators on Instagram</h1>
        <p className="mt-0.5 text-sm text-gray-400 dark:text-gray-500">
          Find creators we don&apos;t have yet, size them up, and message them yourself.
        </p>
      </div>
      <ScoutPanel />
    </div>
  );
}
