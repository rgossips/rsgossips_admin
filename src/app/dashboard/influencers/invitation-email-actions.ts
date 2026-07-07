"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { sendMail } from "@/lib/mailer";
import { renderOnboardingInviteEmail } from "@/lib/email-templates";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEmail, clampLen } from "@/lib/validation";
import { logError } from "@/lib/log";

// Cap on the admin-supplied note so this manual send can't be abused to
// smuggle a large arbitrary payload through the branded invite template.
const MAX_CUSTOM_MSG = 500;
// Per-admin send budget: this action takes an arbitrary recipient + note,
// so it's the app's closest thing to an open email relay. Bound it hard.
const EMAIL_LIMIT = 30;
const EMAIL_WINDOW_SEC = 60 * 60; // 30 invite emails / admin / hour

// Manually send an onboarding email to an invited influencer. We don't
// store the recipient email on the invitation row (admins seed
// invitations by IG handle), so the address is supplied at click time
// from the row UI. Strictly manual — never run from a schedule or trigger.
export async function sendInfluencerInvitationEmail(
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
    .from("influencer_invitations")
    .select("id, full_name, instagram_username, status")
    .eq("id", invitationId)
    .maybeSingle();
  if (invErr) { logError("send-invite-email.lookup", invErr, { invitationId }); return { error: "Could not load the invitation. Please try again." }; }
  if (!invitation) return { error: "Invitation not found" };
  if (invitation.status !== "pending") {
    return { error: `Invitation is already ${invitation.status}` };
  }

  // Best-effort: include the inviting admin's name in the email copy.
  let invitedByName: string | undefined;
  try {
    const { data: me } = await adminClient
      .from("admin_profiles")
      .select("full_name, email")
      .eq("id", actorId)
      .maybeSingle();
    invitedByName = me?.full_name || me?.email || undefined;
  } catch {
    /* non-fatal — copy just falls back to "The RecentGossips team" */
  }

  // Onboarding URL on the public app. Keeps the @handle in the path so
  // landing can prefill the Instagram login step.
  const inviteUrl = `https://rgossips.com/?invited=${encodeURIComponent(invitation.instagram_username)}`;

  const { html, text } = renderOnboardingInviteEmail({
    kind: "creator",
    fullName: invitation.full_name || `@${invitation.instagram_username}`,
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
    logError("send-invite-email.send", e, { invitationId, actorId });
    return { error: "Could not send the email right now. Please try again." };
  }

  return { success: true };
}
