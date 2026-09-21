// Copy for every creator nudge: email (HTML + text) and the in-app push.
//
// Inline styles only — email clients strip <style>. Same look as
// src/lib/email-templates.ts. Every number in the copy comes from live data
// at send time (NudgeVars); nothing here invents urgency, discounts or
// "brands are looking at you" claims we can't back up.

import type { NudgeKey } from "./constants";
import type { NudgeVars } from "./segments";

const SITE = "https://rgossips.com";
const GRADIENT = "linear-gradient(135deg, #6366F1 0%, #A855F7 50%, #EC4899 100%)";

export type RenderedNudge = {
  subject: string;
  preview: string;
  html: string;
  text: string;
  push: { title: string; text: string; link: string };
};

type Block =
  | { p: string }
  | { list: string[] }
  | { plans: { name: string; price: string; points: string[]; highlight?: boolean }[] };

type Spec = {
  subject: string;
  preview: string;
  heading: string;
  blocks: Block[];
  cta: { label: string; path: string };
  push: { title: string; text: string };
};

const n = (x: number) => x.toLocaleString("en-IN");

function spec(key: NudgeKey, v: NudgeVars): Spec {
  const hi = `Hi ${v.firstName},`;
  switch (key) {
    case "a1":
      return {
        subject: `${v.firstName}, ${n(v.activeCampaigns)} brand campaigns are open right now`,
        preview: "You have 3 free applications. Here's how to make them count.",
        heading: "Your first brand deal starts here",
        blocks: [
          { p: hi },
          { p: `Your profile is live in brand search, and there are <strong>${n(v.activeCampaigns)} active campaigns</strong> on RGossips right now. You can apply to <strong>${v.freeLeft} more</strong> for free.` },
          { p: "Three things that get creators picked:" },
          {
            list: [
              "<strong>Add your categories and bio</strong> — brands filter by them.",
              "<strong>Apply to campaigns in your niche</strong> — a close match beats a big following.",
              "<strong>Keep Instagram connected</strong> — brands see your live reach and engagement.",
            ],
          },
        ],
        cta: { label: "Browse campaigns", path: "/influencer/campaigns" },
        push: { title: `${n(v.activeCampaigns)} campaigns are open`, text: `You have ${v.freeLeft} free applications left — find a campaign in your niche.` },
      };
    case "a2":
      return {
        subject: "Get seen first by brands — plans from ₹99/month",
        preview: "More applications, priority placement and audience insights.",
        heading: "What a plan unlocks",
        blocks: [
          { p: hi },
          { p: "Free accounts get 3 barter applications, once. A plan keeps you applying every month — and the higher tiers put you in front of brands first." },
          {
            plans: [
              { name: "Starter", price: "₹99/mo", points: ["3 applications every month", "25 AI captions & pitches a month", "Listed in brand search"] },
              { name: "Pro", price: "₹299/mo", points: ["15 applications a month", "Priority placement in brand search", "Audience insights: age, gender, city", "150 AI generations a month"], highlight: true },
              { name: "Elite", price: "₹699/mo", points: ["Unlimited applications", "Top placement + homepage spotlight", "Payouts within 48 hours"] },
            ],
          },
        ],
        cta: { label: "See plans", path: "/influencer/pricing" },
        push: { title: "Keep applying every month", text: "Plans start at ₹99/month — more applications, priority placement, audience insights." },
      };
    case "a3":
      return {
        subject: `${v.firstName}, save 25% with an annual plan`,
        preview: "Annual plans cost about the same as 9 months.",
        heading: "Pay for 9 months, get 12",
        blocks: [
          { p: hi },
          { p: "If you're planning to take brand deals this year, the annual plans work out to roughly 25% less than paying monthly:" },
          {
            list: [
              "<strong>Starter</strong> — ₹899/year (about ₹75/month instead of ₹99). For creators just starting out.",
              "<strong>Pro</strong> — ₹2,699/year (about ₹225/month instead of ₹299). For 10K+ creators who want more deals.",
              "<strong>Elite</strong> — ₹6,299/year (about ₹525/month instead of ₹699). For full-time creators.",
            ],
          },
          { p: "Same features either way — annual just costs less." },
        ],
        cta: { label: "Choose a plan", path: "/influencer/pricing" },
        push: { title: "Save 25% with annual", text: "Annual plans cost about the same as 9 months of monthly." },
      };
    case "b1": {
      const fresh = v.newCampaigns7d > 0
        ? `<strong>${n(v.newCampaigns7d)} new campaign${v.newCampaigns7d === 1 ? "" : "s"}</strong> went live this week, and ${n(v.activeCampaigns)} are open in total.`
        : `There are <strong>${n(v.activeCampaigns)} campaigns</strong> open right now.`;
      return {
        subject: v.newCampaigns7d > 0 ? `${n(v.newCampaigns7d)} new campaigns since you last looked` : `${n(v.activeCampaigns)} campaigns are waiting for creators`,
        preview: "Fresh brand campaigns on RGossips.",
        heading: "Here's what you missed",
        blocks: [
          { p: hi },
          { p: fresh },
          { p: v.subscribed ? "Your plan is active — take a look and apply to the ones that fit your niche." : `You still have <strong>${v.freeLeft} free application${v.freeLeft === 1 ? "" : "s"}</strong> to use.` },
        ],
        cta: { label: "See campaigns", path: "/influencer/campaigns" },
        push: { title: "New campaigns this week", text: v.newCampaigns7d > 0 ? `${n(v.newCampaigns7d)} new campaigns went live — take a look.` : `${n(v.activeCampaigns)} campaigns are open — take a look.` },
      };
    }
    case "b2": {
      const reconnect = v.igStatus === "reconnect" || v.igStatus === "not_connected";
      return {
        subject: `Keep your profile fresh for brands, ${v.firstName}`,
        preview: reconnect ? "Your Instagram connection needs attention." : "Brands see the numbers from your last refresh.",
        heading: "Brands see your latest numbers",
        blocks: [
          { p: hi },
          { p: "When a brand looks at your profile, they see your follower count, engagement and reach from the last time RGossips refreshed your Instagram. Opening the app keeps them current." },
          reconnect
            ? { p: "<strong>Your Instagram connection has stopped working</strong> (this happens after a password change). Reconnect it so brands see your real numbers." }
            : v.igStatus === "insights_denied"
              ? { p: "<strong>Instagram isn't sharing your insights with us.</strong> Reconnect and keep \"insights\" switched on so brands can see your reach and views." }
              : { p: "It takes a few seconds — and your media kit updates with it." },
        ],
        cta: { label: reconnect || v.igStatus === "insights_denied" ? "Reconnect Instagram" : "Open RGossips", path: "/influencer" },
        push: { title: "Keep your profile fresh", text: reconnect ? "Your Instagram connection needs a quick reconnect." : "Open RGossips to refresh your stats for brands." },
      };
    }
    case "c1":
      return {
        subject: "You've used your 3 free applications — keep applying",
        preview: "Pro gives you 15 applications every month.",
        heading: "Nice work — you're applying",
        blocks: [
          { p: hi },
          { p: `You've applied to <strong>${n(v.appsUsed)} campaigns</strong>, which uses up the free applications. To keep applying:` },
          {
            list: [
              "<strong>Pro — ₹299/month:</strong> 15 applications every month, priority placement in brand search and audience insights.",
              "<strong>Starter — ₹99/month:</strong> 3 applications every month.",
            ],
          },
        ],
        cta: { label: "Keep applying", path: "/influencer/pricing" },
        push: { title: "Free applications used up", text: "Pro gives you 15 applications a month — keep applying." },
      };
    case "c2":
      return {
        subject: "Brands can't find you without categories",
        preview: "Two minutes on your profile gets you into more brand searches.",
        heading: "Finish your profile",
        blocks: [
          { p: hi },
          { p: "Brands search RGossips by category, and they read your bio before they pick a creator. Profiles without them rarely show up in a search." },
          { list: ["<strong>Pick your categories</strong> — fashion, food, tech, travel…", "<strong>Write a one-line bio</strong> — who you are and what you post."] },
        ],
        cta: { label: "Complete my profile", path: "/influencer/profile" },
        push: { title: "Finish your profile", text: "Add your categories and bio so brands can find you." },
      };
    case "c3":
      // The in-app reconnect banner (rgossips_web InstagramReconnectBanner)
      // opens on /influencer for all three states.
      if (v.igStatus === "insights_denied") {
        return {
          subject: "Reconnect Instagram to show your reach and views",
          preview: "Instagram isn't sharing your insights with us yet.",
          heading: "Show brands your real reach",
          blocks: [
            { p: hi },
            { p: "Your Instagram is connected, but <strong>insights were switched off</strong> when you connected it — so brands can't see your reach, views or audience." },
            { p: "Reconnect and leave <strong>\"insights\"</strong> ticked on the Instagram screen. It takes under a minute." },
          ],
          cta: { label: "Reconnect Instagram", path: "/influencer" },
          push: { title: "Show brands your reach", text: "Reconnect Instagram and keep \"insights\" switched on." },
        };
      }
      if (v.igStatus === "reconnect") {
        return {
          subject: `${v.firstName}, your Instagram connection has stopped working`,
          preview: "A quick reconnect keeps your numbers live for brands.",
          heading: "Reconnect your Instagram",
          blocks: [
            { p: hi },
            { p: "Instagram has <strong>disconnected RGossips</strong> from your account — this usually happens after a password change. Until you reconnect, brands see old numbers on your profile and media kit." },
            { p: "Reconnecting takes under a minute. Keep \"insights\" ticked so brands can see your reach too." },
          ],
          cta: { label: "Reconnect Instagram", path: "/influencer" },
          push: { title: "Instagram disconnected", text: "Reconnect so brands see your current numbers." },
        };
      }
      return {
        subject: "Connect Instagram to start getting brand deals",
        preview: "Brands need your follower and engagement numbers.",
        heading: "Connect your Instagram",
        blocks: [
          { p: hi },
          { p: "Your Instagram <strong>isn't connected</strong> yet. Brands choose creators by their followers, engagement and reach — without them, your profile can't compete." },
          { p: "Connect it once and RGossips keeps your numbers and media kit up to date. Keep \"insights\" ticked so brands can see your reach too." },
        ],
        cta: { label: "Connect Instagram", path: "/influencer" },
        push: { title: "Connect your Instagram", text: "Brands need your numbers — connect Instagram to start applying." },
      };
  }
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

// Copy strings may carry <strong> tags; everything user-derived (names,
// numbers) is escaped before it is interpolated into them.
function blockHtml(b: Block): string {
  if ("p" in b) return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">${b.p}</p>`;
  if ("list" in b) {
    return `<ul style="margin:0 0 18px 0;padding-left:20px;color:#374151;">${b.list
      .map((li) => `<li style="margin:0 0 8px 0;font-size:15px;line-height:1.55;">${li}</li>`)
      .join("")}</ul>`;
  }
  const cols = b.plans
    .map(
      (pl) => `<td valign="top" style="padding:6px;width:${Math.floor(100 / b.plans.length)}%;">
        <div style="border:${pl.highlight ? "2px solid #A855F7" : "1px solid #E5E7EB"};border-radius:14px;padding:14px 12px;background:${pl.highlight ? "#FAF5FF" : "#FFFFFF"};">
          <div style="font-size:14px;font-weight:700;color:#111827;">${pl.name}</div>
          <div style="font-size:13px;font-weight:600;color:#7C3AED;margin:2px 0 8px 0;">${pl.price}</div>
          ${pl.points.map((pt) => `<div style="font-size:12px;line-height:1.45;color:#4B5563;margin:0 0 5px 0;">✓ ${pt}</div>`).join("")}
        </div>
      </td>`,
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 18px 0;"><tr>${cols}</tr></table>`;
}

function blockText(b: Block): string {
  if ("p" in b) return stripTags(b.p);
  if ("list" in b) return b.list.map((li) => `• ${stripTags(li)}`).join("\n");
  return b.plans.map((pl) => `${pl.name} (${pl.price}): ${pl.points.join("; ")}`).join("\n");
}

function escapeVars(v: NudgeVars): NudgeVars {
  return { ...v, firstName: esc(v.firstName) };
}

export function renderNudge(key: NudgeKey, vars: NudgeVars, unsubscribeUrl: string): RenderedNudge {
  const s = spec(key, escapeVars(vars));
  const plain = spec(key, vars);
  const ctaUrl = `${SITE}${s.cta.path}`;
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(plain.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,sans-serif;color:#1F2937;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(plain.preview)}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#F4F5F8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.08);">
          <tr>
            <td style="background:${GRADIENT};padding:32px 32px;text-align:center;color:#ffffff;">
              <div style="font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">RGossips</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px;">${esc(plain.heading)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              ${s.blocks.map(blockHtml).join("\n")}
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:8px auto 8px auto;">
                <tr>
                  <td style="background:${GRADIENT};border-radius:12px;">
                    <a href="${esc(ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">${esc(plain.cta.label)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#F9FAFB;padding:18px 32px;text-align:center;border-top:1px solid #E5E7EB;">
              <p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;">&copy; ${year} RGossips &middot; <a href="${SITE}" style="color:#6B7280;text-decoration:none;">rgossips.com</a></p>
              <p style="margin:0;font-size:11px;color:#9CA3AF;">You're getting this because you have a creator account on RGossips. <a href="${esc(unsubscribeUrl)}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe from these emails</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    ...plain.blocks.map(blockText),
    "",
    `${plain.cta.label}: ${ctaUrl}`,
    "",
    "— RGossips",
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n\n").replace(/\n{3,}/g, "\n\n");

  return {
    subject: plain.subject,
    preview: plain.preview,
    html,
    text,
    push: { title: plain.push.title, text: plain.push.text, link: plain.cta.path },
  };
}
