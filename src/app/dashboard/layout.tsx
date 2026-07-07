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
  // RLS can't return a misleading empty result. This layout is the READ gate
  // for every dashboard page (pages fetch with the service-role client), so
  // it must FAIL CLOSED — a user we can't positively confirm as an admin does
  // not get rendered the dashboard. This portal shares a Supabase project with
  // the consumer app, so a non-admin user CAN hold a valid session here.
  const { createAdminClient } = await import("@/utils/supabase/admin");
  const adminClient = createAdminClient();

  // Look up THIS user's admin row, with one bounded retry to ride out a
  // transient error (avoids logging a real admin out on a network blip)
  // without the old "let everyone in on error" fail-open.
  let role: "super_admin" | "admin" | "viewer" | null = null;
  let fullName = "";
  let confirmed = false;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: adminProfile, error: lookupErr } = await adminClient
      .from("admin_profiles")
      .select("id, role, full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (!lookupErr) {
      confirmed = true;
      if (adminProfile) {
        role = (adminProfile.role as typeof role) || null;
        fullName = adminProfile.full_name || "";
      }
      break;
    }
    lastErr = lookupErr;
  }

  // Confirmed-not-an-admin OR confirmed-but-no-valid-role → this is not an
  // admin. Sign out and bounce. (A consumer user landing here gets ejected.)
  if (confirmed && (!role || !["super_admin", "admin", "viewer"].includes(role))) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Could not confirm after retries (persistent lookup error) → fail closed.
  // Redirect to /login WITHOUT signing out, so a genuine admin simply retries
  // and a transient error doesn't nuke their session.
  if (!confirmed) {
    console.error("[dashboard-layout] admin_profiles lookup failed; failing closed", {
      userId: user.id,
      err: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    redirect("/login");
  }

  return (
    <DashboardShell userEmail={user.email || ""} userName={fullName} role={role}>{children}</DashboardShell>
  );
}
