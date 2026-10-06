// Application status emails sent from the admin portal.
//
// The rule, same as the consumer app's: whoever did NOT cause the change gets
// told. When an admin changes an application's status, neither the brand nor
// the creator pressed the button, so BOTH hear about it — and the copy says
// the RGossips team did it, because "the brand rejected you" would be a lie.
//
// This mirrors rgossips_web's supabase/functions/_shared/application-emails.ts,
// which handles the brand-initiated and creator-initiated cases. Two copies
// exist only because a Next.js server action cannot import a Deno module;
// change one and change the other, or the same event reads differently
// depending on who triggered it.
//
// Every send is best-effort: the status change has already committed, and a
// mail failure must never surface as a failed action.

import { sendMail } from "@/lib/mailer";
import { createAdminClient } from "@/utils/supabase/admin";
import { logError } from "@/lib/log";
import { emailBanner, emailBrandMark, emailLogo } from "@/lib/email-templates";

// Local copy: email-templates keeps its own private one, and exporting it
// just for this would widen that module's surface for a four-line helper.
function escapeHtml(v: string) {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SITE = "https://rgossips.com";

type Side = "creator" | "brand";

export type Vars = {
  campaignTitle: string;
  campaignId: string;
  creatorName: string;
  brandName: string;
  reason?: string | null;
};

export type Copy = { subject: string; headline: string; body: string; ctaLabel: string };

// Statuses an admin can set that are worth an email. Anything missing is
// silent on purpose — `pending` is where an application starts, `withdrawn` is
// the creator's own doing, and `payment` belongs to the escrow-release flow.
// Exported so the copy can be rendered without going through a send —
// previewing what a creator will actually receive should not require
// emailing one.
export const CREATOR_COPY: Record<string, (v: Vars) => Copy> = {
  // "Shortlisted", never "on hold". The admin is parking a decision; the
  // creator is being told they made the cut so far. Saying "on hold" to them
  // reads as a rejection with extra steps, and saying "approved" would be a
  // promise nobody has made — so the copy is warm about the shortlist and
  // explicit that the decision is still open.
  on_hold: (v) => ({
    subject: `You've been shortlisted for "${v.campaignTitle}"`,
    headline: "Shortlisted",
    body: `Good news — your application for <strong>${v.campaignTitle}</strong> with ${v.brandName} has been shortlisted. The final selection hasn't been made yet, so there's nothing for you to do right now. We'll tell you either way, and you don't need to apply again.`,
    ctaLabel: "See the campaign",
  }),
  approved: (v) => ({
    subject: `You're approved for "${v.campaignTitle}"`,
    headline: "You're in",
    body: `Your application for <strong>${v.campaignTitle}</strong> with ${v.brandName} has been approved. Read the brief once more, then start creating — you can submit your draft in the app.`,
    ctaLabel: "Open the campaign",
  }),
  accepted: (v) => ({
    subject: `Your work for "${v.campaignTitle}" was accepted`,
    headline: "Accepted",
    body: `Your submission for <strong>${v.campaignTitle}</strong> has been accepted. Post it live and add the link in the app — that's the last step.`,
    ctaLabel: "Add your live link",
  }),
  revision_needed: (v) => ({
    subject: `Changes requested on "${v.campaignTitle}"`,
    headline: "Changes requested",
    body: `Your submission for <strong>${v.campaignTitle}</strong> needs a few changes before it can be accepted. Make the edits and resubmit in the app — nothing is lost.`,
    ctaLabel: "See what's needed",
  }),
  rejected: (v) => ({
    subject: `Your application for "${v.campaignTitle}" wasn't accepted`,
    headline: "Not this time",
    body: `Your application for <strong>${v.campaignTitle}</strong> hasn't been taken forward. It happens to every creator, and there are other campaigns open right now.`,
    ctaLabel: "Browse campaigns",
  }),
  completed: (v) => ({
    subject: `"${v.campaignTitle}" is complete`,
    headline: "That's a wrap",
    body: `Your work on <strong>${v.campaignTitle}</strong> is marked complete. Nice one.`,
    ctaLabel: "View the campaign",
  }),
  live_submitted: (v) => ({
    subject: `Your live link for "${v.campaignTitle}" is recorded`,
    headline: "Live link recorded",
    body: `The live link for <strong>${v.campaignTitle}</strong> is on your application. We'll let you know when the brand wraps it up.`,
    ctaLabel: "View the campaign",
  }),
};

const BRAND_COPY: Record<string, (v: Vars) => Copy> = {
  // The brand gets the admin's word for it — they are the one who may still
  // take this creator, so "shortlisted" would understate what happened.
  on_hold: (v) => ({
    subject: `${v.creatorName} was shortlisted for "${v.campaignTitle}"`,
    headline: "An applicant was shortlisted",
    body: `<strong>${v.creatorName}</strong> has been put on hold for <strong>${v.campaignTitle}</strong> by the RGossips team — kept as a strong applicant without being approved yet, so they are still available if you want them.`,
    ctaLabel: "Open the campaign",
  }),
  approved: (v) => ({
    subject: `${v.creatorName} was approved for "${v.campaignTitle}"`,
    headline: "An application was approved",
    body: `<strong>${v.creatorName}</strong> has been approved for <strong>${v.campaignTitle}</strong> by the RGossips team.`,
    ctaLabel: "Open the campaign",
  }),
  accepted: (v) => ({
    subject: `${v.creatorName}'s work for "${v.campaignTitle}" was accepted`,
    headline: "Work accepted",
    body: `<strong>${v.creatorName}</strong>'s submission for <strong>${v.campaignTitle}</strong> was accepted by the RGossips team.`,
    ctaLabel: "Open the campaign",
  }),
  revision_needed: (v) => ({
    subject: `Changes were requested from ${v.creatorName} for "${v.campaignTitle}"`,
    headline: "Changes requested",
    body: `The RGossips team asked <strong>${v.creatorName}</strong> for changes to their submission for <strong>${v.campaignTitle}</strong>.`,
    ctaLabel: "Open the campaign",
  }),
  rejected: (v) => ({
    subject: `${v.creatorName}'s application for "${v.campaignTitle}" was declined`,
    headline: "An application was declined",
    body: `<strong>${v.creatorName}</strong>'s application for <strong>${v.campaignTitle}</strong> was declined by the RGossips team.`,
    ctaLabel: "Open the campaign",
  }),
  completed: (v) => ({
    subject: `"${v.campaignTitle}" was marked complete for ${v.creatorName}`,
    headline: "Application completed",
    body: `<strong>${v.creatorName}</strong>'s work on <strong>${v.campaignTitle}</strong> was marked complete.`,
    ctaLabel: "Open the campaign",
  }),
  live_submitted: (v) => ({
    subject: `${v.creatorName} posted their content for "${v.campaignTitle}"`,
    headline: "It's live",
    body: `<strong>${v.creatorName}</strong>'s live link for <strong>${v.campaignTitle}</strong> is in. Check it, then mark the application complete.`,
    ctaLabel: "See the post",
  }),
  submitted: (v) => ({
    subject: `${v.creatorName} submitted work for "${v.campaignTitle}"`,
    headline: "A draft is waiting for you",
    body: `<strong>${v.creatorName}</strong> has a draft in for <strong>${v.campaignTitle}</strong>. Review it in the app — accept it, or ask for changes with a note.`,
    ctaLabel: "Review the draft",
  }),
};

// Strip trailing whitespace from every line, and empty the whitespace-only
// ones entirely.
//
// Quoted-printable has to escape a space that sits at the end of a line, so a
// line containing nothing but indentation encodes as "=20" — and denomailer
// leaves that visible in the delivered mail. An empty interpolation like
// `${reasonBlock}` sitting on its own indented line is exactly that case, and
// it shipped a stray "=20" above the button in the approval email.
//
// Trailing whitespace never means anything in HTML, so this is free.
function tidy(html: string): string {
  return html
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

export function renderApplicationEmail(
  copy: Copy,
  ctaUrl: string,
  reason?: string | null,
  // Optional, because a campaign without a banner (or a brand without a
  // logo) must still send a clean email rather than a broken box.
  imagery?: { bannerUrl?: string | null; brandLogoUrl?: string | null; brandName?: string },
) {
  const reasonBlock = reason
    ? `<div style="margin:0 0 20px;padding:14px 16px;background:#F3F4F6;border-radius:12px;border-left:3px solid #9CA3AF;">
         <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#4B5563;text-transform:uppercase;letter-spacing:1px;">Note</p>
         <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;">${reason}</p>
       </div>`
    : "";

  // Images are optional and each degrades to nothing rather than a broken
  // box — a campaign may have no banner, a brand may have no logo.
  const bannerRow = emailBanner(imagery?.bannerUrl, imagery?.brandName ? `${imagery.brandName} campaign` : "");
  const brandRow = imagery?.brandLogoUrl
    ? `<p style="margin:0 0 16px;font-size:13px;color:#6B7280;">${emailBrandMark(imagery.brandLogoUrl, imagery.brandName || "Brand")}<span style="vertical-align:middle;font-weight:600;color:#374151;">${escapeHtml(imagery.brandName || "Brand")}</span></p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${copy.headline}</title></head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
        <tr><td style="background:linear-gradient(135deg, #6366F1 0%, #A855F7 50%, #EC4899 100%);padding:36px 32px;text-align:center;color:#ffffff;">
          ${emailLogo()}
          <div style="font-size:22px;font-weight:700;margin-top:6px;">${copy.headline}</div>
        </td></tr>
        ${bannerRow}
        <tr><td style="padding:36px 36px 28px 36px;">
          ${brandRow}
          <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#374151;">${copy.body}</p>
          ${reasonBlock}
          <div style="margin:26px 0 8px;">
            <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366F1,#EC4899);color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:13px 26px;border-radius:14px;">${copy.ctaLabel}</a>
          </div>
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">You're receiving this because of a campaign on RGossips. Questions? Just reply to this email.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="margin:0;font-size:12px;color:#6B7280;">&copy; ${new Date().getFullYear()} RGossips &middot; <a href="${SITE}" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [copy.headline, "", copy.body.replace(/<[^>]+>/g, ""), ...(reason ? ["", `Note: ${reason}`] : []), "", `${copy.ctaLabel}: ${ctaUrl}`, "", "- RGossips"].join("\n");
  return { html: tidy(html), text };
}

// Resolve an address the same way the consumer app's sendBrandedEmail does:
// the profile column first, then the auth user. A creator usually has no
// email at all, which is a silent skip, not a failure.
async function resolveEmail(side: Side, userId: string): Promise<string> {
  const admin = createAdminClient();
  try {
    if (side === "creator") {
      const { data } = await admin.from("influencer_profiles").select("email").eq("influencer_id", userId).maybeSingle();
      if (data?.email) return data.email;
    } else {
      const { data } = await admin.from("brand_profiles").select("contact_email").eq("brand_id", userId).maybeSingle();
      if (data?.contact_email) return data.contact_email;
    }
  } catch {
    /* fall through to auth */
  }
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email || "";
  } catch {
    return "";
  }
}

/**
 * The campaign's banner and the brand's logo, for the email header.
 *
 * Read here rather than asked of every caller: the campaign id is all any
 * of them has, and an email missing its imagery because one call site
 * forgot a parameter is exactly the kind of inconsistency nobody notices
 * until a creator mentions it.
 *
 * Both are PUBLIC storage URLs (campaign-images / brand-icons), which is
 * what makes them usable in mail at all — an email client cannot fetch a
 * signed URL, and would render a broken image forever once one expired.
 */
async function campaignImagery(campaignId: string): Promise<{
  bannerUrl: string | null;
  brandLogoUrl: string | null;
}> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("campaigns")
      .select("description, brand_profiles(logo_url)")
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (!data) return { bannerUrl: null, brandLogoUrl: null };
    let bannerUrl: string | null = null;
    const rawDesc = String(data.description || "");
    // The separator is SIX characters. Hard-coding 5 left a stray newline in
    // front of the JSON — JSON.parse tolerates that, so it would have looked
    // like it worked while being wrong.
    const SEP = "\n\n---\n";
    const at = rawDesc.indexOf(SEP);
    const json = at !== -1 ? rawDesc.slice(at + SEP.length) : rawDesc.trimStart().startsWith("{") ? rawDesc : "";
    if (json) {
      try {
        const meta = JSON.parse(json);
        if (typeof meta?.banner_image === "string" && meta.banner_image.startsWith("http")) {
          bannerUrl = meta.banner_image;
        }
      } catch {
        /* a malformed trailer just means no banner */
      }
    }
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const logo = (data as any).brand_profiles?.logo_url;
    return {
      bannerUrl,
      brandLogoUrl: typeof logo === "string" && logo.startsWith("http") ? logo : null,
    };
  } catch (e) {
    logError("application-emails.imagery", e, { campaignId });
    return { bannerUrl: null, brandLogoUrl: null };
  }
}

export async function sendAdminApplicationStatusEmails(opts: {
  status: string;
  campaignId: string;
  campaignTitle: string;
  creatorUserId: string | null;
  brandUserId: string | null;
  creatorName: string;
  brandName: string;
  reason?: string | null;
}): Promise<void> {
  const imagery = await campaignImagery(opts.campaignId);

  const vars: Vars = {
    campaignTitle: opts.campaignTitle,
    campaignId: opts.campaignId,
    creatorName: opts.creatorName,
    brandName: opts.brandName,
    reason: opts.reason ?? null,
  };

  const targets: { side: Side; userId: string | null; copy?: Copy; path: string }[] = [
    { side: "creator", userId: opts.creatorUserId, copy: CREATOR_COPY[opts.status]?.(vars), path: `/influencer/offers/${opts.campaignId}` },
    { side: "brand", userId: opts.brandUserId, copy: BRAND_COPY[opts.status]?.(vars), path: `/brands/campaign/${opts.campaignId}` },
  ];

  for (const t of targets) {
    if (!t.copy || !t.userId) continue;
    try {
      const to = await resolveEmail(t.side, t.userId);
      if (!to) continue;
      // The reason is only ever shown to the creator — it is written for them,
      // and the brand already knows what it asked for.
      const { html, text } = renderApplicationEmail(
        t.copy,
        `${SITE}${t.path}`,
        t.side === "creator" ? opts.reason : null,
        { ...imagery, brandName: opts.brandName },
      );
      await sendMail({ to, subject: t.copy.subject, html, text });
    } catch (e) {
      logError("application-status-email", e, { side: t.side, status: opts.status, campaignId: opts.campaignId });
    }
  }
}
