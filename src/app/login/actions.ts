"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";
import { sendMail } from "@/lib/mailer";
import { renderPasswordResetEmail } from "@/lib/email-templates";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEmail } from "@/lib/validation";
import { logError } from "@/lib/log";

// Self-service password reset for admins from the login screen. UNAUTHENTICATED
// by nature, so it is written to be safe:
//   - Always returns the same generic success, whether or not the email maps to
//     an admin — never reveals which addresses are admins (enumeration guard).
//   - Rate-limited per email so it can't be used to spam someone's inbox.
//   - Only sends to an address that actually has an admin_profiles row; other
//     users of the shared Supabase project (creators/brands) get nothing here.
// The link is a Supabase recovery link → /auth/callback, which already drives
// the "set a new password" screen.
export async function requestPasswordReset(email: string): Promise<{ success: true }> {
  const clean = (email || "").trim().toLowerCase();
  const generic = { success: true } as const;
  if (!isEmail(clean)) return generic;

  // Per-email throttle. Fails open on limiter infra error (logged there).
  const limit = await enforceRateLimit({
    action: "admin_pw_reset",
    actorId: clean,
    limit: 3,
    windowSec: 3600,
    target: clean,
  });
  if (!limit.allowed) return generic; // silently drop — don't reveal or spam

  try {
    const adminClient = createAdminClient();

    // Must be an actual admin. Look up the auth user, then confirm the profile.
    const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = list?.users.find((u) => (u.email || "").toLowerCase() === clean);
    if (!user) return generic;

    const { data: profile } = await adminClient
      .from("admin_profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) return generic;

    const redirectTo = `${await getSiteUrl()}/auth/callback`;
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: profile.email || clean,
      options: { redirectTo },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      logError("login.requestPasswordReset.link", linkErr);
      return generic;
    }

    const { html, text } = renderPasswordResetEmail({
      fullName: profile.full_name || "there",
      resetUrl: linkData.properties.action_link,
    });
    await sendMail({
      to: profile.email || clean,
      subject: "Reset your RecentGossips Admin password",
      html,
      text,
    });
  } catch (e) {
    // Never surface internals to an unauthenticated caller.
    logError("login.requestPasswordReset", e);
  }

  return generic;
}
