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

// True for both "admin" and "super_admin" — anyone who is allowed to
// perform day-to-day write actions (everything except managing other
// admins and deleting users). Viewers are read-only and return false.
export async function isAdminOrAbove(): Promise<boolean> {
  const { role } = await getCurrentAdminRole();
  return role === "admin" || role === "super_admin";
}

// Throws if the caller isn't a super admin. Use from server actions
// before performing privileged operations like user deletion.
export async function requireSuperAdmin(): Promise<string> {
  const { userId, role } = await getCurrentAdminRole();
  if (!userId) throw new Error("Not authenticated — please sign in again");
  if (role !== "super_admin") throw new Error("Only super admins can perform this action");
  return userId;
}

// Throws if the caller isn't an admin or super admin. Use from server
// actions that perform writes (create, update, delete) but aren't
// destructive enough to require super admin (e.g. editing a profile vs
// deleting a user entirely).
export async function requireAdmin(): Promise<string> {
  const { userId, role } = await getCurrentAdminRole();
  if (!userId) throw new Error("Not authenticated — please sign in again");
  if (role !== "admin" && role !== "super_admin") {
    throw new Error("This action requires admin access. Viewers have read-only access.");
  }
  return userId;
}

// Returns an `{ error }` instead of throwing — convenient for server
// actions that have a `{ error?: string }` return contract and want to
// reject viewer-only callers cleanly. Returns `null` on success.
export async function adminGate(): Promise<{ error: string } | null> {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
}

export async function superAdminGate(): Promise<{ error: string } | null> {
  try {
    await requireSuperAdmin();
    return null;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }
}

// Passes for ANY admin role (super_admin | admin | viewer), rejects a
// caller with no admin_profiles row. Use to gate READ-only server actions
// that viewers legitimately need (e.g. the featured-* pickers, section-
// title getters) — server actions bypass the dashboard layout, so an
// ungated read action is directly reachable by any authenticated user of
// the shared Supabase project and leaks data. Returns null when allowed.
export async function viewerGate(): Promise<{ error: string } | null> {
  const { role } = await getCurrentAdminRole();
  if (role === "super_admin" || role === "admin" || role === "viewer") return null;
  return { error: "This action requires admin access." };
}
