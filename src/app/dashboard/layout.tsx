import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { getAdminProfile } from "@/lib/require-super-admin";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // One resolution per request, shared with every gate the page calls —
  // getAdminProfile() is React-cached, so this costs one lookup, not four.
  const { userId, role, fullName, email, confirmed } = await getAdminProfile();

  if (!userId) {
    redirect("/login");
  }

  // This layout is the READ gate for every dashboard page (pages fetch with
  // the service-role client), so it FAILS CLOSED — a user we can't positively
  // confirm as an admin is not rendered the dashboard. This portal shares a
  // Supabase project with the consumer app, so a non-admin user CAN hold a
  // valid session here.
  //
  // Confirmed-not-an-admin OR confirmed-but-no-valid-role → sign out and
  // bounce. (A consumer user landing here gets ejected.)
  if (confirmed && (!role || !["super_admin", "admin", "viewer"].includes(role))) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Could not confirm after retries (persistent lookup error) → fail closed.
  // Redirect to /login WITHOUT signing out, so a genuine admin simply retries
  // and a transient error doesn't nuke their session.
  if (!confirmed) {
    console.error("[dashboard-layout] admin_profiles lookup failed; failing closed", { userId });
    redirect("/login");
  }

  return (
    <DashboardShell userEmail={email} userName={fullName} role={role as "super_admin" | "admin" | "viewer" | null}>
      {children}
    </DashboardShell>
  );
}
