import { cache } from "react";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

// Every dashboard render used to ask Supabase "who is this user?" three
// times — middleware, the layout, then each page's gate — and re-read
// admin_profiles for each gate. The project is in Mumbai and the site runs
// as functions elsewhere, so each of those was a ~250ms round trip before
// any page data was fetched.
//
// Two fixes, both here:
//   * getClaims() verifies the session token locally where it can, instead
//     of a network call to /auth/v1/user. It falls back to getUser() when
//     the token can't be verified offline, so behaviour is unchanged.
//   * React's cache() memoises the whole resolution for the lifetime of one
//     request, so the layout and every gate on the page share one answer.

// The role is read with the service-role client to bypass RLS — the
// session-bound client would need explicit RLS policies on admin_profiles
// to allow self-reads, which we don't want to rely on here.

/**
 * The signed-in user, verified. `getClaims()` checks the JWT signature
 * locally when the project uses asymmetric keys and only calls the auth
 * server otherwise — either way it never returns an unverified identity.
 */
export const getCurrentUser = cache(async (): Promise<{ id: string; email: string } | null> => {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as { sub?: string; email?: string } | undefined;
    if (!error && claims?.sub) return { id: claims.sub, email: claims.email || "" };
  } catch {
    /* fall through to the network check */
  }
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email || "" } : null;
});

/** The caller's admin row. One lookup per request, shared by every gate. */
export const getAdminProfile = cache(
  async (): Promise<{ userId: string | null; role: string | null; fullName: string; email: string; confirmed: boolean }> => {
    const user = await getCurrentUser();
    if (!user) return { userId: null, role: null, fullName: "", email: "", confirmed: false };
    const admin = createAdminClient();
    // One bounded retry — a transient error must not read as "not an admin",
    // which is what the dashboard layout fails closed on.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await admin
        .from("admin_profiles")
        .select("role, full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (!error) {
        return {
          userId: user.id,
          role: (data?.role as string) || null,
          fullName: data?.full_name || "",
          email: user.email,
          confirmed: true,
        };
      }
    }
    return { userId: user.id, role: null, fullName: "", email: user.email, confirmed: false };
  },
);

// Returns the current user's admin role, or null if not logged in / not an admin.
// Safe to use from server components for conditional rendering.
export async function getCurrentAdminRole(): Promise<{ userId: string | null; role: string | null }> {
  const { userId, role } = await getAdminProfile();
  return { userId, role };
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
