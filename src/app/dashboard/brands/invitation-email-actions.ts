"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, getCurrentAdminRole } from "@/lib/require-super-admin";
import { sendMail } from "@/lib/mailer";
import { renderOnboardingInviteEmail } from "@/lib/email-templates";

// Manually send an onboarding email to an invited brand. Mirrors the
// influencer side — see [[sendInfluencerInvitationEmail]].
export async function sendBrandInvitationEmail(
  invitationId: string,
  email: string,
  customMessage?: string,
): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const cleaned = (email || "").trim().toLowerCase();
  if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    return { error: "Enter a valid email address" };
  }

  const adminClient = createAdminClient();
  const { data: invitation, error: invErr } = await adminClient
    .from("brand_invitations")
    .select("id, brand_name, instagram_username, status")
    .eq("id", invitationId)
    .maybeSingle();
  if (invErr) return { error: invErr.message };
  if (!invitation) return { error: "Invitation not found" };
  if (invitation.status !== "pending") {
    return { error: `Invitation is already ${invitation.status}` };
  }

  let invitedByName: string | undefined;
  try {
    const { userId } = await getCurrentAdminRole();
    if (userId) {
      const { data: me } = await adminClient
        .from("admin_profiles")
        .select("full_name, email")
        .eq("id", userId)
        .maybeSingle();
      invitedByName = me?.full_name || me?.email || undefined;
    }
  } catch {
    /* non-fatal */
  }

  const inviteUrl = `https://rgossips.com/?invited=${encodeURIComponent(invitation.instagram_username)}`;

  const { html, text } = renderOnboardingInviteEmail({
    kind: "brand",
    fullName: invitation.brand_name || `@${invitation.instagram_username}`,
    instagramUsername: invitation.instagram_username,
    inviteUrl,
    invitedByName,
    customMessage: customMessage?.trim() || undefined,
  });

  try {
    await sendMail({
      to: cleaned,
      subject: "You're invited to join RecentGossips",
      html,
      text,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send email" };
  }

  return { success: true };
}
