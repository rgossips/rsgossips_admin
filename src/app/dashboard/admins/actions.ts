"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";
import { getSiteUrl } from "@/lib/site-url";
import { sendMail } from "@/lib/mailer";
import { renderAdminInviteEmail } from "@/lib/email-templates";

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
  const redirectTo = `${await getSiteUrl()}/auth/callback`;

  // Step 1: Check if there's already an auth user for this email. If a
  // prior invite half-finished (auth user created but admin_profiles row
  // wasn't, or email send failed), Supabase will refuse a fresh `invite`
  // with "already registered". In that case we adopt the existing user
  // and send a recovery link instead — same UX for the recipient.
  let userId: string | null = null;
  let acceptUrl: string | null = null;

  // findUserByEmail isn't always exposed cleanly — list users with a
  // server-side filter. Small admin team so this stays fast.
  const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users.find(
    (u) => (u.email || "").toLowerCase() === email.toLowerCase()
  );

  if (existing) {
    // If they already have an admin_profiles row, refuse with a clear msg.
    const { data: existingProfile } = await adminClient
      .from("admin_profiles")
      .select("role")
      .eq("id", existing.id)
      .maybeSingle();
    if (existingProfile) {
      return {
        error: `This email is already an admin (${existingProfile.role}). Remove them first if you want to re-invite.`,
      };
    }

    // Orphan auth user — rescue them by generating a recovery link.
    userId = existing.id;
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (linkError) return { error: linkError.message };
    acceptUrl = linkData?.properties?.action_link || null;
  } else {
    // Fresh invite — create user + invite link.
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: fullName }, redirectTo },
    });
    if (linkError) return { error: linkError.message };
    acceptUrl = linkData?.properties?.action_link || null;
    userId = linkData?.user?.id || null;
  }

  if (!acceptUrl || !userId) {
    return { error: "Failed to generate invite link" };
  }

  // Step 2: Upsert the admin_profiles row — `generateLink` returns the
  // existing user when the email is already in auth, which would
  // otherwise hit a duplicate-key error on re-invite. Upsert lets us
  // simply update the row instead.
  const { error: profileError } = await adminClient
    .from("admin_profiles")
    .upsert(
      { id: userId, email, full_name: fullName, role },
      { onConflict: "id" }
    );

  if (profileError) {
    return { error: profileError.message };
  }

  // Step 3: Send the invite email through our own SMTP.
  try {
    // Look up the inviting admin's display name for the email copy.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    let invitedByName: string | undefined;
    if (user) {
      const { data: me } = await adminClient
        .from("admin_profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle();
      invitedByName = me?.full_name || me?.email || undefined;
    }

    const { html, text } = renderAdminInviteEmail({
      fullName,
      invitedByName,
      acceptUrl,
      role,
    });

    await sendMail({
      to: email,
      subject: "You're invited to the RecentGossips Admin Portal",
      html,
      text,
    });
  } catch (mailErr) {
    // The auth user + profile exist but no email was sent. We do NOT
    // delete them automatically — they may have existed before this
    // invite (re-invite case) and removing them would orphan their
    // history. Surface the SMTP error so the admin can re-try.
    return {
      error:
        "Account is ready but the invite email failed to send: " +
        (mailErr instanceof Error ? mailErr.message : "Unknown error") +
        ". Check SMTP env vars and try again — clicking Invite again will resend the email.",
    };
  }

  revalidatePath("/dashboard/admins");
  return { success: true };
}

// Resends the invite/recovery link email to an admin who hasn't yet
// accepted (or who simply lost the original email). Uses a recovery link
// because it works for already-existing auth users without errors.
export async function resendAdminInvite(adminId: string) {
  await requireSuperAdmin();

  const adminClient = createAdminClient();
  const { data: profile, error: profileErr } = await adminClient
    .from("admin_profiles")
    .select("email, full_name, role")
    .eq("id", adminId)
    .maybeSingle();

  if (profileErr || !profile) return { error: "Admin not found" };

  const redirectTo = `${await getSiteUrl()}/auth/callback`;
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "recovery",
    email: profile.email,
    options: { redirectTo },
  });

  if (linkError) return { error: linkError.message };
  const acceptUrl = linkData?.properties?.action_link;
  if (!acceptUrl) return { error: "Failed to generate link" };

  try {
    // Resolve the inviting admin's display name for the email copy.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    let invitedByName: string | undefined;
    if (user) {
      const { data: me } = await adminClient
        .from("admin_profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle();
      invitedByName = me?.full_name || me?.email || undefined;
    }

    const { html, text } = renderAdminInviteEmail({
      fullName: profile.full_name,
      invitedByName,
      acceptUrl,
      role: profile.role,
    });
    await sendMail({
      to: profile.email,
      subject: "Your RecentGossips Admin invitation (resent)",
      html,
      text,
    });
  } catch (e) {
    return { error: "Failed to resend email: " + (e instanceof Error ? e.message : "Unknown error") };
  }

  revalidatePath("/dashboard/admins");
  return { success: true };
}

export async function updateAdminRole(adminId: string, newRole: string) {
  const currentUser = await requireSuperAdmin();

  if (!["super_admin", "admin", "viewer"].includes(newRole)) {
    return { error: "Invalid role" };
  }
  // Block self-demotion — otherwise a super_admin could lock themselves
  // out and there'd be no path back without DB access.
  if (adminId === currentUser.id) {
    return { error: "You can't change your own role" };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("admin_profiles")
    .update({ role: newRole })
    .eq("id", adminId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admins");
  return { success: true };
}

export async function removeAdmin(adminId: string) {
  const currentUser = await requireSuperAdmin();

  if (adminId === currentUser.id) {
    return { error: "You cannot remove yourself" };
  }

  const adminClient = createAdminClient();

  // Remove from admin_profiles first
  const { error: profileError } = await adminClient
    .from("admin_profiles")
    .delete()
    .eq("id", adminId);

  if (profileError) {
    return { error: profileError.message };
  }

  // Also delete the auth user. Without this the email becomes "orphaned"
  // — generateLink with type=invite refuses on the next attempt because
  // the auth user still exists.
  const { error: authErr } = await adminClient.auth.admin.deleteUser(adminId);
  if (authErr) {
    // Profile is already gone — surface the auth error so the super admin
    // knows the orphan exists but don't fail outright (manual cleanup via
    // the inviteAdmin re-rescue path will still work).
    return {
      error: `Admin record removed but auth user couldn't be deleted: ${authErr.message}`,
    };
  }

  revalidatePath("/dashboard/admins");
  return { success: true };
}

// Hard-deletes an orphaned auth user by email. Useful when a previous
// invite half-finished — the auth user exists but no admin_profiles row,
// so it never shows up in the list yet still blocks fresh invites.
export async function purgeOrphanAuthUser(email: string) {
  await requireSuperAdmin();
  if (!email) return { error: "Email is required" };

  const adminClient = createAdminClient();
  const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = list?.users.find(
    (u) => (u.email || "").toLowerCase() === email.toLowerCase()
  );
  if (!user) return { error: "No auth user found for that email" };

  // Refuse if they have an admin_profiles row (use removeAdmin for those).
  const { data: profile } = await adminClient
    .from("admin_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile) {
    return { error: "This email is a registered admin — use Remove instead." };
  }

  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admins");
  return { success: true };
}
