import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { toggleServiceActive } from "./actions";
import { isAdminOrAbove } from "@/lib/require-super-admin";

import { ActionButton } from "@/components/action-button";
export const dynamic = "force-dynamic";

export default async function ServicesPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const t = await getTranslations("DashboardServices");
  const sp = (await searchParams) || {};
  const status = sp.status || "all"; // 'all' | 'active' | 'inactive'

  const admin = createAdminClient();
  const canWrite = await isAdminOrAbove();
  let q = admin
    .from("services")
    .select("*")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (status === "active") q = q.eq("is_active", true);
  else if (status === "inactive") q = q.eq("is_active", false);
  const { data: services, error } = await q;

  const activeCount = (services || []).filter((s) => s.is_active).length;
  const inactiveCount = (services || []).filter((s) => !s.is_active).length;

  // Pending quote requests for the badge.
  const { count: pendingQuotes } = await admin
    .from("service_orders")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending_quote");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("subtitle")}
          </p>
        </div>
        {canWrite && (
          <Link
            href="/dashboard/services/create"
            className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Service
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatPill label="Total" value={(services || []).length} />
        <StatPill label="Active" value={activeCount} accent="text-emerald-600" />
        <StatPill label="Inactive" value={inactiveCount} accent="text-gray-400" />
        <Link
          href="/dashboard/quote-requests"
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-indigo-300 transition-colors"
        >
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Pending quote requests
          </p>
          <p className="text-xl font-bold text-indigo-600 mt-1">{pendingQuotes ?? 0}</p>
          <p className="text-[10px] text-indigo-500 mt-0.5">View inbox →</p>
        </Link>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {(["all", "active", "inactive"] as const).map((s) => (
          <Link
            key={s}
            href={`/dashboard/services?status=${s}`}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-full ${
              status === s
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error.message}
        </div>
      )}

      {/* Service rows */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
        {(services || []).length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            No services yet. Create your first one.
          </div>
        ) : (
          (services || []).map((s) => (
            <ServiceRow key={s.id} service={s} canWrite={canWrite} />
          ))
        )}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </p>
      <p className={`text-xl font-bold mt-1 ${accent || "text-gray-900 dark:text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function ServiceRow({ service, canWrite }: { service: any; canWrite: boolean }) {
  const price = `₹${Number(service.price_starting || 0).toLocaleString("en-IN")}${
    service.price_suffix || ""
  }`;
  const tagColor = service.accent || "bg-slate-100 text-slate-600";

  return (
    <div className="flex items-center gap-4 p-4">
      <span
        className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${tagColor}`}
      >
        {service.tag}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{service.title}</p>
          <p className="text-[11px] text-gray-400 truncate">/{service.slug}</p>
        </div>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {service.description}
        </p>
      </div>
      <div className="hidden sm:block text-right shrink-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white">{price}</p>
        <p className="text-[10px] text-gray-400">
          {service.delivery_days || "—"} · SLA {service.quote_sla_hours}h
        </p>
      </div>
      <span
        className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
          service.is_active
            ? "bg-emerald-50 text-emerald-700"
            : "bg-gray-100 text-gray-500"
        }`}
      >
        {service.is_active ? "Active" : "Inactive"}
      </span>
      {canWrite && (
        <>
          <Link
            href={`/dashboard/services/${service.id}/edit`}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Edit
          </Link>
          <form
            action={async () => {
              "use server";
              await toggleServiceActive(service.id, !service.is_active);
            }}
          >
            <ActionButton
              className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              {service.is_active ? "Deactivate" : "Activate"}
            </ActionButton>
          </form>
        </>
      )}
    </div>
  );
}
