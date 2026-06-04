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
