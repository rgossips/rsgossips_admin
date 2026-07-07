"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { sendMail } from "@/lib/mailer";
import { renderOnboardingInviteEmail } from "@/lib/email-templates";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEmail, clampLen } from "@/lib/validation";
import { logError } from "@/lib/log";

const MAX_CUSTOM_MSG = 500;
const EMAIL_LIMIT = 30;
const EMAIL_WINDOW_SEC = 60 * 60;

// Manually send an onboarding email to an invited brand. Mirrors the
// influencer side — see [[sendInfluencerInvitationEmail]].
export async function sendBrandInvitationEmail(
  invitationId: string,
  email: string,
  customMessage?: string,
): Promise<{ error?: string; success?: boolean }> {
  let actorId: string;
  try { actorId = await requireAdmin(); }
  catch (e) { return { error: e instanceof Error ? e.message : "Forbidden" }; }

  const cleaned = (email || "").trim().toLowerCase();
  if (!isEmail(cleaned)) {
    return { error: "Enter a valid email address" };
  }

  const rl = await enforceRateLimit({
    action: "send_invite_email",
    actorId,
    limit: EMAIL_LIMIT,
    windowSec: EMAIL_WINDOW_SEC,
    target: cleaned,
  });
  if (!rl.allowed) {
    return { error: "You're sending invite emails too quickly. Try again later." };
  }

  const adminClient = createAdminClient();
  const { data: invitation, error: invErr } = await adminClient
    .from("brand_invitations")
    .select("id, brand_name, instagram_username, status")
    .eq("id", invitationId)
    .maybeSingle();
  if (invErr) { logError("send-brand-invite-email.lookup", invErr, { invitationId }); return { error: "Could not load the invitation. Please try again." }; }
  if (!invitation) return { error: "Invitation not found" };
  if (invitation.status !== "pending") {
    return { error: `Invitation is already ${invitation.status}` };
  }

  let invitedByName: string | undefined;
  try {
    const { data: me } = await adminClient
      .from("admin_profiles")
      .select("full_name, email")
      .eq("id", actorId)
      .maybeSingle();
    invitedByName = me?.full_name || me?.email || undefined;
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
    customMessage: clampLen(customMessage, MAX_CUSTOM_MSG) || undefined,
  });

  try {
    await sendMail({
      to: cleaned,
      subject: "You're invited to join RecentGossips",
      html,
      text,
    });
  } catch (e) {
    logError("send-brand-invite-email.send", e, { invitationId, actorId });
    return { error: "Could not send the email right now. Please try again." };
  }

  return { success: true };
}
