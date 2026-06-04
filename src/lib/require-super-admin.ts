import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

// Reads the role using the service-role client to bypass RLS — the
// session-bound client would need explicit RLS policies on admin_profiles
// to allow self-reads, which we don't want to rely on here.
async function readRoleFor(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("admin_profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return data?.role || null;
}

// Returns the current user's admin role, or null if not logged in / not an admin.
// Safe to use from server components for conditional rendering.
export async function getCurrentAdminRole(): Promise<{ userId: string | null; role: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userId: null, role: null };
  const role = await readRoleFor(user.id);
  return { userId: user.id, role };
}

export async function isSuperAdmin(): Promise<boolean> {
  const { role } = await getCurrentAdminRole();
  return role === "super_admin";
}

// Throws if the caller isn't a super admin. Use from server actions
// before performing privileged operations like user deletion.
export async function requireSuperAdmin(): Promise<string> {
  const { userId, role } = await getCurrentAdminRole();
  if (!userId) throw new Error("Not authenticated — please sign in again");
  if (role !== "super_admin") throw new Error("Only super admins can perform this action");
  return userId;
}
