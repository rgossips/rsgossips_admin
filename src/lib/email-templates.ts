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
  <title>You've been invited to RecentGossips Admin</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
          <!-- Header / gradient banner -->
          <tr>
            <td style="background:${GRADIENT};padding:36px 32px;text-align:center;color:#ffffff;">
              <div style="font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">RecentGossips</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px;">Admin Invitation</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px 36px;">
              <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">
                ${inviter} invited you to join the <strong>RecentGossips Admin Portal</strong> as a <strong>${roleLabel}</strong>.
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
                &copy; ${new Date().getFullYear()} RecentGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a>
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
    `${invitedByName || "An admin"} has invited you to join the RecentGossips Admin Portal as a ${roleLabel}.`,
    "",
    "Accept the invitation and set up your password here:",
    acceptUrl,
    "",
    "This invitation expires in 7 days. If you didn't expect this email, ignore it.",
    "",
    "— RecentGossips",
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
    ? `<strong>${escapeHtml(invitedByName)}</strong> from RecentGossips has`
    : "The RecentGossips team has";
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
  <title>You're invited to RecentGossips</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
          <tr>
            <td style="background:${GRADIENT};padding:36px 32px;text-align:center;color:#ffffff;">
              <div style="font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">RecentGossips</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px;">You're invited to join as a ${role}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 36px 28px 36px;">
              <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">
                ${inviter} invited <strong>@${escapeHtml(instagramUsername)}</strong> to join <strong>RecentGossips</strong>.
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
                &copy; ${new Date().getFullYear()} RecentGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a>
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
    `${invitedByName || "The RecentGossips team"} invited @${instagramUsername} to join RecentGossips as a ${role}.`,
    "",
    blurb,
    "",
    ...(customMessage ? ["Message from your inviter:", customMessage, ""] : []),
    "Claim your account here:",
    inviteUrl,
    "",
    "— RecentGossips",
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
    ? "Your RecentGossips account has been temporarily suspended. While suspended you won't be able to sign in, post, or receive new collaboration requests."
    : "Good news — your RecentGossips account has been reactivated. You can sign in again and pick up where you left off.";
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
          <div style="font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">RecentGossips</div>
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
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RecentGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
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
    "— RecentGossips",
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
<title>Your RecentGossips ${what} has been removed</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:linear-gradient(135deg, #6B7280 0%, #1F2937 100%);padding:36px 32px;text-align:center;color:#ffffff;">
          <div style="font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">RecentGossips</div>
          <div style="font-size:22px;font-weight:700;margin-top:6px;">Account removed</div>
        </td></tr>
        <tr><td style="padding:36px 36px 28px 36px;">
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">
            Your RecentGossips ${what} has been removed. All of your profile data, listings, applications, and order history have been deleted from our systems.
          </p>
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">
            If you believe this was a mistake, reply to this email within 30 days and we'll review the case.
          </p>
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">Thank you for being part of RecentGossips.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RecentGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    `Your RecentGossips ${what} has been removed. All of your profile data, listings, applications, and order history have been deleted from our systems.`,
    "",
    "If you believe this was a mistake, reply to this email within 30 days and we'll review the case.",
    "",
    "— RecentGossips",
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
<title>Reset your RecentGossips Admin password</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:${GRADIENT};padding:36px 32px;text-align:center;color:#ffffff;">
          <div style="font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">RecentGossips</div>
          <div style="font-size:22px;font-weight:700;margin-top:6px;">Password reset</div>
        </td></tr>
        <tr><td style="padding:36px 36px 28px 36px;">
          <p style="margin:0 0 16px 0;font-size:18px;font-weight:600;color:#111827;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">
            We received a request to reset the password for your RecentGossips Admin account. Click the button below to choose a new one. This link expires in 1 hour.
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
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RecentGossips &middot; <a href="https://rgossips.com" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hi ${fullName},`,
    "",
    "We received a request to reset the password for your RecentGossips Admin account. Open the link below to choose a new one (expires in 1 hour):",
    "",
    resetUrl,
    "",
    "If you didn't request this, you can safely ignore this email — your password won't change.",
    "",
    "— RecentGossips",
  ].join("\n");

  return { html, text };
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
