// Branded HTML for transactional emails. Keep inline styles only —
// email clients (Gmail, Outlook, Apple Mail) don't reliably load
// remote stylesheets and many strip <style> tags entirely.

interface AdminInviteParams {
  fullName: string;
  invitedByName?: string;
  acceptUrl: string;
  role: string;
}

const PRIMARY = "#6366F1"; // indigo-500
const GRADIENT = "linear-gradient(135deg, #6366F1 0%, #A855F7 50%, #EC4899 100%)";

export function renderAdminInviteEmail({ fullName, invitedByName, acceptUrl, role }: AdminInviteParams) {
  const roleLabel =
    role === "super_admin" ? "Super Admin" : role === "admin" ? "Admin" : "Viewer";
  const inviter = invitedByName ? `<strong>${escapeHtml(invitedByName)}</strong> has` : "You have been";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited to RGossips Admin</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
          <!-- Header / gradient banner -->
          <tr>
            <td style="background:${GRADIENT};padding:36px 32px;text-align:center;color:#ffffff;">
              ${emailLogo()}
              <div style="font-size:22px;font-weight:700;margin-top:6px;">Admin Invitation</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px 36px;">
              <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">
                ${inviter} invited you to join the <strong>RGossips Admin Portal</strong> as a <strong>${roleLabel}</strong>.
              </p>
              <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:#374151;">
                Click the button below to accept the invitation and set up your password.
              </p>

              <!-- CTA button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 28px auto;">
                <tr>
                  <td style="background:${GRADIENT};border-radius:12px;">
                    <a href="${escapeAttr(acceptUrl)}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:12px;color:#6B7280;text-align:center;">
                Or paste this link into your browser:
              </p>
              <p style="margin:0 0 24px 0;font-size:12px;color:${PRIMARY};word-break:break-all;text-align:center;">
                <a href="${escapeAttr(acceptUrl)}" style="color:${PRIMARY};text-decoration:none;">${escapeHtml(acceptUrl)}</a>
              </p>

              <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />

              <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">
                This invitation will expire in 7 days. If you didn't expect this email, you can safely ignore it &mdash;
                no account will be created until you click the link above.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#6B7280;">
                &copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    `${invitedByName || "An admin"} has invited you to join the RGossips Admin Portal as a ${roleLabel}.`,
    "",
    "Accept the invitation and set up your password here:",
    acceptUrl,
    "",
    "This invitation expires in 7 days. If you didn't expect this email, ignore it.",
    "",
    "— RGossips",
  ].join("\n");

  return { html, text };
}

// ── User onboarding invitation (sent manually from invited-row UI) ───────
//
// `kind` controls the title + copy ("creator" vs "brand"). We collect the
// recipient email at click time rather than storing it on the invitation
// row — admin keeps a soft record by Instagram handle and emails are added
// when (and if) we have one.

interface OnboardingInviteParams {
  kind: "creator" | "brand";
  fullName: string;
  instagramUsername: string;
  inviteUrl: string;
  invitedByName?: string;
  customMessage?: string;
}

export function renderOnboardingInviteEmail({
  kind,
  fullName,
  instagramUsername,
  inviteUrl,
  invitedByName,
  customMessage,
}: OnboardingInviteParams) {
  const role = kind === "creator" ? "Creator" : "Brand";
  const inviter = invitedByName
    ? `<strong>${escapeHtml(invitedByName)}</strong> from RGossips has`
    : "The RGossips team has";
  const blurb =
    kind === "creator"
      ? "Connect your Instagram, build your media kit, and start receiving paid collaboration offers from brands you actually want to work with."
      : "Discover vetted creators, run barter and paid campaigns, and manage everything in one place.";

  const customBlock = customMessage
    ? `<div style="margin:0 0 24px 0;padding:14px 16px;background:#F3F4F6;border-radius:12px;border-left:3px solid ${PRIMARY};">
         <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;">${escapeHtml(customMessage)}</p>
       </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to RGossips</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
          <tr>
            <td style="background:${GRADIENT};padding:36px 32px;text-align:center;color:#ffffff;">
              ${emailLogo()}
              <div style="font-size:22px;font-weight:700;margin-top:6px;">You're invited to join as a ${role}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 36px 28px 36px;">
              <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">
                ${inviter} invited <strong>@${escapeHtml(instagramUsername)}</strong> to join <strong>RGossips</strong>.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">${blurb}</p>
              ${customBlock}
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background:${GRADIENT};border-radius:12px;">
                    <a href="${escapeAttr(inviteUrl)}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                      Claim your account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:12px;color:#6B7280;text-align:center;">Or paste this link into your browser:</p>
              <p style="margin:0 0 24px 0;font-size:12px;color:${PRIMARY};word-break:break-all;text-align:center;">
                <a href="${escapeAttr(inviteUrl)}" style="color:${PRIMARY};text-decoration:none;">${escapeHtml(inviteUrl)}</a>
              </p>
              <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
              <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">
                If this wasn't meant for you, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#6B7280;">
                &copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    `${invitedByName || "The RGossips team"} invited @${instagramUsername} to join RGossips as a ${role}.`,
    "",
    blurb,
    "",
    ...(customMessage ? ["Message from your inviter:", customMessage, ""] : []),
    "Claim your account here:",
    inviteUrl,
    "",
    "— RGossips",
  ].join("\n");

  return { html, text };
}

// ── Account status change (suspend / reactivate) ─────────────────────────

interface UserStatusParams {
  fullName: string;
  action: "suspended" | "reactivated";
  reason?: string;
}

export function renderUserStatusEmail({ fullName, action, reason }: UserStatusParams) {
  const isSuspend = action === "suspended";
  const subjectFragment = isSuspend ? "suspended" : "reactivated";
  const headline = isSuspend ? "Your account has been suspended" : "Welcome back — your account is active again";
  const body = isSuspend
    ? "Your RGossips account has been temporarily suspended. While suspended you won't be able to sign in, post, or receive new collaboration requests."
    : "Good news — your RGossips account has been reactivated. You can sign in again and pick up where you left off.";
  const next = isSuspend
    ? "If you believe this was a mistake or want to appeal, reply to this email and our team will get back to you."
    : "Open the app to continue with your collaborations.";

  const reasonBlock = isSuspend && reason
    ? `<div style="margin:0 0 20px 0;padding:14px 16px;background:#FEF3C7;border-radius:12px;border-left:3px solid #F59E0B;">
         <p style="margin:0 0 4px 0;font-size:12px;font-weight:600;color:#92400E;text-transform:uppercase;letter-spacing:1px;">Reason</p>
         <p style="margin:0;font-size:14px;line-height:1.6;color:#92400E;white-space:pre-wrap;">${escapeHtml(reason)}</p>
       </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Account ${subjectFragment}</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:${isSuspend ? "linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)" : "linear-gradient(135deg, #10B981 0%, #059669 100%)"};padding:36px 32px;text-align:center;color:#ffffff;">
          ${emailLogo()}
          <div style="font-size:22px;font-weight:700;margin-top:6px;">${headline}</div>
        </td></tr>
        <tr><td style="padding:36px 36px 28px 36px;">
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#374151;">${body}</p>
          ${reasonBlock}
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">${next}</p>
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">If you didn't expect this email, please reply so we can look into it.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    body,
    ...(isSuspend && reason ? ["", `Reason: ${reason}`] : []),
    "",
    next,
    "",
    "— RGossips",
  ].join("\n");

  return { html, text, subjectFragment };
}

// ── Account deletion ─────────────────────────────────────────────────────

interface UserDeletedParams {
  fullName: string;
  kind: "influencer" | "brand";
}

export function renderUserDeletedEmail({ fullName, kind }: UserDeletedParams) {
  const what = kind === "influencer" ? "creator account" : "brand account";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your RGossips ${what} has been removed</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:linear-gradient(135deg, #6B7280 0%, #1F2937 100%);padding:36px 32px;text-align:center;color:#ffffff;">
          ${emailLogo()}
          <div style="font-size:22px;font-weight:700;margin-top:6px;">Account removed</div>
        </td></tr>
        <tr><td style="padding:36px 36px 28px 36px;">
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">
            Your RGossips ${what} has been removed. All of your profile data, listings, applications, and order history have been deleted from our systems.
          </p>
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">
            If you believe this was a mistake, reply to this email within 30 days and we'll review the case.
          </p>
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">Thank you for being part of RGossips.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    `Your RGossips ${what} has been removed. All of your profile data, listings, applications, and order history have been deleted from our systems.`,
    "",
    "If you believe this was a mistake, reply to this email within 30 days and we'll review the case.",
    "",
    "— RGossips",
  ].join("\n");

  return { html, text };
}

// ── Admin password reset ─────────────────────────────────────────────────

interface PasswordResetParams {
  fullName: string;
  resetUrl: string;
}

export function renderPasswordResetEmail({ fullName, resetUrl }: PasswordResetParams) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Reset your RGossips Admin password</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:${GRADIENT};padding:36px 32px;text-align:center;color:#ffffff;">
          ${emailLogo()}
          <div style="font-size:22px;font-weight:700;margin-top:6px;">Password reset</div>
        </td></tr>
        <tr><td style="padding:36px 36px 28px 36px;">
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">
            We received a request to reset the password for your RGossips Admin account. Click the button below to choose a new one. This link expires in 1 hour.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center" style="padding:8px 0 24px 0;">
            <a href="${escapeAttr(resetUrl)}" style="display:inline-block;background:${GRADIENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:12px;">Reset password</a>
          </td></tr></table>
          <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6B7280;">Or paste this link into your browser:</p>
          <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;word-break:break-all;">
            <a href="${escapeAttr(resetUrl)}" style="color:${PRIMARY};text-decoration:none;">${escapeHtml(resetUrl)}</a>
          </p>
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    "We received a request to reset the password for your RGossips Admin account. Open the link below to choose a new one (expires in 1 hour):",
    "",
    resetUrl,
    "",
    "If you didn't request this, you can safely ignore this email — your password won't change.",
    "",
    "— RGossips",
  ].join("\n");

  return { html, text };
}

// ── Campaign pulled back to "coming soon" ────────────────────────────────

interface CampaignComingSoonParams {
  fullName: string;
  campaignTitle: string;
  bannerUrl?: string | null;
  brandLogoUrl?: string | null;
  brandName?: string;
  /** Rendered blocks from lib/campaign-suggestions — "" when there is nothing open. */
  suggestionsHtml?: string;
  suggestionsText?: string;
}

/**
 * Sent to everyone who had already applied when an admin takes a live
 * campaign back to "coming soon".
 *
 * Deliberately NOT the generic on-hold / "you've been shortlisted" copy,
 * even though the application lands on the same `on_hold` status. Nobody
 * shortlisted these creators — the campaign was pulled back — and telling
 * them otherwise would be a flattering lie they would act on.
 *
 * The three things it has to land: this is not a rejection, their
 * application is kept, and they do not need to do anything or re-apply.
 */
export function renderCampaignComingSoonEmail({
  fullName,
  campaignTitle,
  suggestionsHtml = "",
  suggestionsText = "",
  bannerUrl,
  brandLogoUrl,
  brandName,
}: CampaignComingSoonParams) {
  const bannerRow = emailBanner(bannerUrl, campaignTitle);
  const brandRow = brandLogoUrl
    ? `<p style="margin:0 0 16px;font-size:13px;color:#6B7280;">${emailBrandMark(brandLogoUrl, brandName || "Brand")}<span style="vertical-align:middle;font-weight:600;color:#374151;">${escapeHtml(brandName || "Brand")}</span></p>`
    : "";
  const subject = `"${campaignTitle}" is being prepared — your application is saved`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Campaign update</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:linear-gradient(135deg, #7C3AED 0%, #9810FA 100%);padding:36px 32px;text-align:center;color:#ffffff;">
          ${emailLogo()}
          <div style="font-size:22px;font-weight:700;margin-top:6px;">This one's not quite ready</div>
        </td></tr>
        ${bannerRow}
        <tr><td style="padding:36px 36px 28px 36px;">
          ${brandRow}
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#374151;">
            <strong>${escapeHtml(campaignTitle)}</strong> has gone back to being prepared, so it isn't taking
            applications at the moment.
          </p>
          <div style="margin:0 0 20px 0;padding:14px 16px;background:#F5F3FF;border-radius:12px;border-left:3px solid #7C3AED;">
            <p style="margin:0;font-size:14px;line-height:1.6;color:#5B21B6;">
              <strong>This isn't a no.</strong> We'll email you the moment it opens so you can apply — you'll be
              among the first to know.
            </p>
          </div>
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:#374151;">
            There's nothing for you to do right now. Plenty of other campaigns are open in the meantime.
          </p>
          ${suggestionsHtml}
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">Questions? Just reply to this email.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    `"${campaignTitle}" has gone back to being prepared, so it isn't taking applications at the moment.`,
    "",
    "This isn't a no. We'll email you the moment it opens so you can apply — you'll",
    "be among the first to know.",
    "",
    "There's nothing for you to do right now. Plenty of other campaigns are open in",
    "the meantime.",
    suggestionsText,
    "",
    "— RGossips",
  ].join("\n");

  return { subject, html, text };
}


// ── Campaign reopened ────────────────────────────────────────────────────

interface CampaignReopenedParams {
  fullName: string;
  campaignTitle: string;
  suggestionsHtml?: string;
  suggestionsText?: string;
  bannerUrl?: string | null;
  brandLogoUrl?: string | null;
  brandName?: string;
}

/**
 * The other half of the coming-soon email. That one promises "we'll tell
 * you the moment it reopens" — this is what keeps it.
 *
 * The thing it has to land: their application is live again and they do
 * NOT need to re-apply. A creator who missed this would either think they
 * had lost their place or apply a second time.
 */
export function renderCampaignReopenedEmail({
  fullName,
  campaignTitle,
  suggestionsHtml = "",
  suggestionsText = "",
  bannerUrl,
  brandLogoUrl,
  brandName,
}: CampaignReopenedParams) {
  const bannerRow = emailBanner(bannerUrl, campaignTitle);
  const brandRow = brandLogoUrl
    ? `<p style="margin:0 0 16px;font-size:13px;color:#6B7280;">${emailBrandMark(brandLogoUrl, brandName || "Brand")}<span style="vertical-align:middle;font-weight:600;color:#374151;">${escapeHtml(brandName || "Brand")}</span></p>`
    : "";
  const subject = `"${campaignTitle}" is open again — your application is live`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Campaign reopened</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:linear-gradient(135deg, #059669 0%, #10B981 100%);padding:36px 32px;text-align:center;color:#ffffff;">
          ${emailLogo()}
          <div style="font-size:22px;font-weight:700;margin-top:6px;">It's open again</div>
        </td></tr>
        ${bannerRow}
        <tr><td style="padding:36px 36px 28px 36px;">
          ${brandRow}
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#374151;">
            Good news — <strong>${escapeHtml(campaignTitle)}</strong> is taking applications again.
          </p>
          <div style="margin:0 0 20px 0;padding:14px 16px;background:#ECFDF5;border-radius:12px;border-left:3px solid #059669;">
            <p style="margin:0;font-size:14px;line-height:1.6;color:#065F46;">
              <strong>You'll need to apply again.</strong> Applications were cleared while the campaign was being
              prepared, and the brief may have changed — so give it a read and put your name forward.
            </p>
          </div>
          <p style="margin:0 0 4px 0;font-size:15px;line-height:1.65;color:#374151;">
            Applications are open now.
          </p>
          ${suggestionsHtml}
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">Questions? Just reply to this email.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    `Good news — "${campaignTitle}" is taking applications again.`,
    "",
    "You'll need to apply again. Applications were cleared while the campaign was",
    "being prepared, and the brief may have changed — so give it a read and put your",
    "name forward.",
    suggestionsText,
    "",
    "— RGossips",
  ].join("\n");

  return { subject, html, text };
}

// ── Campaign closed without a decision ───────────────────────────────────

interface CampaignClosedParams {
  fullName: string;
  campaignTitle: string;
  bannerUrl?: string | null;
  brandLogoUrl?: string | null;
  brandName?: string;
  suggestionsHtml?: string;
  suggestionsText?: string;
}

/**
 * Sent when a campaign is completed or paused while applications were still
 * undecided.
 *
 * Deliberately NOT a rejection, in wording or in the status it accompanies.
 * Nobody assessed these creators — the campaign ended first — and telling
 * someone they "weren't accepted" when nobody read their application is both
 * untrue and the kind of thing that makes a creator stop applying.
 *
 * It closes the loop, which is the entire point: the alternative is the
 * application sitting on "Pending Review" forever, which is what 522 of them
 * were doing when this was built.
 */
export function renderCampaignClosedEmail({
  fullName,
  campaignTitle,
  suggestionsHtml = "",
  suggestionsText = "",
  bannerUrl,
  brandLogoUrl,
  brandName,
}: CampaignClosedParams) {
  const bannerRow = emailBanner(bannerUrl, campaignTitle);
  const brandRow = brandLogoUrl
    ? `<p style="margin:0 0 16px;font-size:13px;color:#6B7280;">${emailBrandMark(brandLogoUrl, brandName || "Brand")}<span style="vertical-align:middle;font-weight:600;color:#374151;">${escapeHtml(brandName || "Brand")}</span></p>`
    : "";
  const subject = `Update on your application to "${campaignTitle}"`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Campaign closed</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:linear-gradient(135deg, #64748B 0%, #475569 100%);padding:36px 32px;text-align:center;color:#ffffff;">
          ${emailLogo()}
          <div style="font-size:22px;font-weight:700;margin-top:6px;">This campaign has closed</div>
        </td></tr>
        ${bannerRow}
        <tr><td style="padding:36px 36px 28px 36px;">
          ${brandRow}
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#374151;">
            <strong>${escapeHtml(campaignTitle)}</strong> has finished, and we're closing your application to it.
          </p>
          <div style="margin:0 0 20px 0;padding:14px 16px;background:#F1F5F9;border-radius:12px;border-left:3px solid #64748B;">
            <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">
              <strong>This isn't a rejection.</strong> The campaign wrapped up before a decision was made on every
              application, and yours was one of them. It says nothing about your work.
            </p>
          </div>
          <p style="margin:0 0 4px 0;font-size:15px;line-height:1.65;color:#374151;">
            Sorry to leave you waiting. Here's what's open now.
          </p>
          ${suggestionsHtml}
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">Questions? Just reply to this email.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    `"${campaignTitle}" has finished, and we're closing your application to it.`,
    "",
    "This isn't a rejection. The campaign wrapped up before a decision was made on",
    "every application, and yours was one of them. It says nothing about your work.",
    "",
    "Sorry to leave you waiting. Here's what's open now.",
    suggestionsText,
    "",
    "— RGossips",
  ].join("\n");

  return { subject, html, text };
}


// ── Imagery ──────────────────────────────────────────────────────────────
//
// Every image in an email must be an absolute, publicly fetchable URL — a
// bundled asset cannot travel, and most clients fetch through a proxy
// (Gmail caches ours). The logo lives in the public `email-assets` bucket,
// which is its own bucket on purpose: mail sent years ago still points at
// it, so it must never be swept up by a cleanup aimed at campaign media.
//
// Images are also BLOCKED by default in a lot of clients, so nothing may
// depend on one rendering. Every image here carries alt text that says the
// same thing the picture does, and no layout collapses without it.
// Two variants, because the backdrop decides which is legible. The
// wordmark is mid-luminance artwork: on the coloured gradient headers every
// template uses, the full-colour version goes muddy, so those get a
// white-on-transparent cut. The colour one is kept for any light surface.
export const EMAIL_LOGO_URL = "https://hlfevcdtbehukxrrgykv.supabase.co/storage/v1/object/public/email-assets/rgossips-logo.png";
export const EMAIL_LOGO_LIGHT_URL = "https://hlfevcdtbehukxrrgykv.supabase.co/storage/v1/object/public/email-assets/rgossips-logo-light.png";

/** The wordmark for a header block. Falls back to the name when blocked. */
export function emailLogo(): string {
  // Served at 2x (512 wide) and displayed at 180, so it stays sharp on a
  // retina screen. Explicit width/height attributes as well as the inline
  // style: Outlook ignores CSS dimensions on images.
  return `<img src="${EMAIL_LOGO_LIGHT_URL}" width="180" height="26" alt="RGossips" style="display:block;margin:0 auto 12px auto;border:0;outline:none;text-decoration:none;width:180px;height:26px;" />`;
}

/**
 * A campaign's banner, full width above the body copy.
 *
 * Height is capped and the image is cropped by the client rather than
 * letterboxed, because campaign banners are not a consistent aspect ratio
 * and a tall one would push the actual message below the fold.
 */
export function emailBanner(url: string | null | undefined, alt = ""): string {
  if (!url) return "";
  return `<tr><td style="padding:0;"><img src="${escapeAttr(String(url))}" alt="${escapeAttr(alt)}" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;outline:none;" /></td></tr>`;
}

/** A brand's logo as a small round avatar, for use beside a campaign name. */
export function emailBrandMark(url: string | null | undefined, brandName: string): string {
  if (!url) return "";
  return `<img src="${escapeAttr(String(url))}" width="28" height="28" alt="${escapeAttr(brandName)}" style="display:inline-block;vertical-align:middle;border-radius:14px;border:1px solid #E5E7EB;margin-right:8px;width:28px;height:28px;object-fit:cover;" />`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(s: string) {
  return s.replace(/"/g, "&quot;");
}
