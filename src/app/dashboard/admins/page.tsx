import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InviteForm } from "./invite-form";
import { AdminsList } from "./admins-list";

export default async function AdminsPage() {
  const t = await getTranslations("DashboardAdmins");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // List admins via the service-role client — RLS on admin_profiles can
  // hide other rows from the session-bound client, making it look like
  // newly invited admins "disappeared". Dashboard layout already gates
  // access to this route, so reading all rows here is safe.
  const adminClient = createAdminClient();

  const { data: currentAdmin } = await adminClient
    .from("admin_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (currentAdmin?.role !== "super_admin") redirect("/dashboard");

  // Load everything once — the admin team is small enough that we can
  // filter in the browser (see [[admins-list]]). Hitting the server on
  // every keystroke was the source of the search/role-filter lag.
  const { data: admins, error } = await adminClient
    .from("admin_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  // Join acceptance status from auth.users. `last_sign_in_at` non-null
  // means they've logged in at least once = invite accepted.
  const authMap = new Map<string, { lastSignInAt: string | null; emailConfirmedAt: string | null; pendingSetup: boolean }>();
  try {
    const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of list?.users || []) {
      authMap.set(u.id, {
        lastSignInAt: u.last_sign_in_at || null,
        emailConfirmedAt: u.email_confirmed_at || null,
        // Set at invite, cleared once the password is chosen. Absent for
        // admins onboarded before this flag existed → treated as done.
        pendingSetup: (u.user_metadata as Record<string, unknown> | undefined)?.pending_setup === true,
      });
    }
  } catch {
    // Non-fatal — without this, every admin will show as "Pending invite"
  }

  const adminsWithAuth = (admins || []).map((a) => {
    const auth = authMap.get(a.id);
    return {
      ...a,
      lastSignInAt: auth?.lastSignInAt ?? null,
      emailConfirmedAt: auth?.emailConfirmedAt ?? null,
      pendingSetup: auth?.pendingSetup ?? false,
    };
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {t("subtitle")}
        </p>
      </div>

      <InviteForm />

      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
          {t("loadError", { message: error.message })}
        </div>
      )}

      <AdminsList admins={adminsWithAuth} currentUserId={user.id} />
    </div>
  );
}
