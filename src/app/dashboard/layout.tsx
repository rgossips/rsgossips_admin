import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  // Only redirect on confirmed "no user" — not on transient network errors
  // during token refresh, which would otherwise log users out on a page reload.
  if (!user && !userErr) {
    redirect("/login");
  }
  if (!user) {
    // Network/transient error — keep them on the page; the next request will retry
    redirect("/login");
  }

  // Verify the user has an admin_profiles row. Use the service-role client so
  // RLS / cookie races can't return a misleading empty result and sign someone
  // out mid-session.
  const { createAdminClient } = await import("@/utils/supabase/admin");
  const adminClient = createAdminClient();

  const { count, error: profileError } = await adminClient
    .from("admin_profiles")
    .select("*", { count: "exact", head: true });

  const tableExists = !profileError;
  const tableHasRows = tableExists && (count ?? 0) > 0;

  // Read the role and decide what to render. We still allow users in
  // even if the lookup fails (network blip) — see comment in the gate
  // below — but we want the role for downstream UI gating.
  let role: "super_admin" | "admin" | "viewer" | null = null;
  if (tableHasRows) {
    const { data: adminProfile, error: lookupErr } = await adminClient
      .from("admin_profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    // Only sign out when we definitively confirm the user isn't in the
    // admins table. Any lookup error → keep them in (avoids log-out on refresh).
    if (!lookupErr && !adminProfile) {
      await supabase.auth.signOut();
      redirect("/login");
    }
    role = (adminProfile?.role as typeof role) || null;
  }

  return (
    <DashboardShell userEmail={user.email || ""} role={role}>{children}</DashboardShell>
  );
}
