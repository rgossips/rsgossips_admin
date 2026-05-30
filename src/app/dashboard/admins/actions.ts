"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { getSiteUrl } from "@/lib/site-url";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "super_admin") {
    throw new Error("Only super admins can manage admin users");
  }

  return user;
}

export async function inviteAdmin(formData: FormData) {
  await requireSuperAdmin();

  const email = formData.get("email") as string;
  const fullName = formData.get("full_name") as string;
  const role = (formData.get("role") as string) || "admin";

  if (!email || !fullName) {
    return { error: "Email and full name are required" };
  }

  if (!["super_admin", "admin", "viewer"].includes(role)) {
    return { error: "Invalid role" };
  }

  const adminClient = createAdminClient();

  // Invite user via Supabase Auth (sends invite email). Pass an explicit
  // redirectTo so the email link lands on OUR admin app — without this,
  // Supabase falls back to the project's Site URL config (typically
  // localhost:3000 in dev) and the invite link is unusable in production.
  const redirectTo = `${getSiteUrl()}/auth/callback`;
  const { data: authData, error: authError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    });

  if (authError) {
    return { error: authError.message };
  }

  // Insert admin profile
  const { error: profileError } = await adminClient
    .from("admin_profiles")
    .insert({
      id: authData.user.id,
      email,
      full_name: fullName,
      role,
    });

  if (profileError) {
    return { error: profileError.message };
  }

  revalidatePath("/dashboard/admins");
  return { success: true };
}

export async function removeAdmin(adminId: string) {
  const currentUser = await requireSuperAdmin();

  if (adminId === currentUser.id) {
    return { error: "You cannot remove yourself" };
  }

  const adminClient = createAdminClient();

  // Remove from admin_profiles
  const { error: profileError } = await adminClient
    .from("admin_profiles")
    .delete()
    .eq("id", adminId);

  if (profileError) {
    return { error: profileError.message };
  }

  revalidatePath("/dashboard/admins");
  return { success: true };
}
