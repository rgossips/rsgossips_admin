import Link from "next/link";
import { redirect } from "next/navigation";
import { ServiceForm } from "../_form/service-form";
import { createService } from "../actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";

export default async function CreateServicePage() {
  if (!(await isAdminOrAbove())) redirect("/dashboard/services");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/services"
          className="text-[12px] font-semibold text-indigo-600 hover:underline"
        >
          ← Services
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New service</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Once published, this service appears in the influencer-side catalogue immediately.
        </p>
      </div>

      <ServiceForm action={createService} submitLabel="Publish Service" />
    </div>
  );
}
