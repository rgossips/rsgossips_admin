import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { redirect } from "next/navigation";
import { InviteForm } from "./invite-form";
import { AdminRow } from "./admin-row";
import { FilterBar } from "@/components/filter-bar";

const filterFields = [
  { name: "search", label: "Search", type: "text" as const, placeholder: "Search by name or email..." },
  {
    name: "role",
    label: "All Roles",
    type: "select" as const,
    options: [
      { label: "Super Admin", value: "super_admin" },
      { label: "Admin", value: "admin" },
      { label: "Viewer", value: "viewer" },
    ],
  },
];

export default async function AdminsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { search, role } = await searchParams;
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

  const isSuperAdmin = currentAdmin?.role === "super_admin";

  let query = adminClient
    .from("admin_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }
  if (role) {
    query = query.eq("role", role);
  }

  const { data: admins, error } = await query;

  // Join acceptance status from auth.users. `last_sign_in_at` non-null
  // means they've logged in at least once = invite accepted.
  const authMap = new Map<string, { lastSignInAt: string | null; emailConfirmedAt: string | null }>();
  try {
    const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of list?.users || []) {
      authMap.set(u.id, {
        lastSignInAt: u.last_sign_in_at || null,
        emailConfirmedAt: u.email_confirmed_at || null,
      });
    }
  } catch {
    // Non-fatal — without this, every admin will show as "Pending invite"
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Users</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Manage who can access this admin panel
        </p>
      </div>

      {isSuperAdmin && <InviteForm />}

      <FilterBar fields={filterFields} />

      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm mb-6">
          Failed to load admins: {error.message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">
                Name
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">
                Email
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">
                Role
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">
                Status
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">
                Added
              </th>
              {isSuperAdmin && (
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-4">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {admins && admins.length > 0 ? (
              admins.map((admin) => {
                const auth = authMap.get(admin.id);
                return (
                  <AdminRow
                    key={admin.id}
                    admin={admin}
                    isSuperAdmin={isSuperAdmin}
                    isCurrentUser={admin.id === user.id}
                    lastSignInAt={auth?.lastSignInAt ?? null}
                    emailConfirmedAt={auth?.emailConfirmedAt ?? null}
                  />
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={isSuperAdmin ? 6 : 5}
                  className="px-6 py-12 text-center text-gray-400 dark:text-gray-500 text-sm"
                >
                  No admin users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
