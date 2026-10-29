"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/require-super-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { clampLen, isEmail } from "@/lib/validation";
import { sendMail } from "@/lib/mailer";
import { notifyUsers } from "@/lib/notify";
import { renderCampaignInviteEmail } from "@/lib/email-templates";
import { mergeNotes } from "@/lib/instagram-profile";
import {
  INVITE_CHUNK_SIZE,
  INVITE_NOTES_KEY,
  campaignUrl,
  inviteBlockedReason,
  inviteMapFromMeta,
  signupUrl,
} from "@/lib/campaign-invite";

// Telling a creator about a campaign we think they fit.
//
// Two channels and two kinds of recipient, and the difference is not
// cosmetic — see the header of lib/campaign-invite.ts:
//
//   registered creator  → campaign_invitations row + in-app notification
//                         (which PUSHES to their phone) + email
//   invited, no account → email only, recorded in the invitation's notes
//
// Everything is re-read and re-decided SERVER-side from the ids the client
// sends. A selection can sit on screen for an hour; by the time it is sent,
// a creator may have applied, claimed their invitation, or been notified by
// another admin. Trusting the client's view would mean emailing somebody
// twice about the same campaign, which is the one failure this whole
// feature exists to avoid.

const MAX_NOTE = 500;
// Per-admin budget. The client chunks at INVITE_CHUNK_SIZE, so this is
// 80 × 10 = up to 800 creators an hour — generous for real work, and a
// hard stop on using the portal as a mail relay.
const CALL_LIMIT = 80;
const CALL_WINDOW_SEC = 60 * 60;

export type InviteResult = {
  error?: string;
  /** In-app notifications created (registered creators only). */
  notified?: number;
  /** Emails that left the building, both kinds of recipient. */
  emailed?: number;
  /** Already invited to THIS campaign — nothing sent, nothing re-sent. */
  alreadyInvited?: number;
  /** Invited-only creators we hold no email for: no channel at all. */
  noChannel?: number;
  /** Applied already, invitation claimed, row gone, or deleted account. */
  skipped?: number;
  /** Emails that failed to send; the in-app notification still landed. */
  emailFailed?: number;
};

/** A zone-less stored date, written the way a creator reads it. */
function prettyDate(value: string | null | undefined): string | null {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const CAMPAIGN_TRAILER = "\n\n---\n";
function campaignMeta(description: string | null | undefined): Record<string, unknown> {
  const raw = String(description || "");
  const at = raw.indexOf(CAMPAIGN_TRAILER);
  const json = at !== -1 ? raw.slice(at + CAMPAIGN_TRAILER.length) : raw.trimStart().startsWith("{") ? raw : "";
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const INVITATION_TRAILER = "\n---\n";
function invitationMeta(notes: string | null | undefined): Record<string, unknown> {
  const raw = String(notes || "");
  const at = raw.indexOf(INVITATION_TRAILER);
  const json = at !== -1 ? raw.slice(at + INVITATION_TRAILER.length) : raw.trimStart().startsWith("{") ? raw : "";
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function inviteCreatorsToCampaign(
  campaignId: string,
  picks: { influencerId?: string | null; invitationId?: string | null }[],
  note?: string,
): Promise<InviteResult> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admins only." };
  }

  if (!Array.isArray(picks) || picks.length === 0) return { notified: 0, emailed: 0 };
  // The client is expected to chunk. Refused rather than silently truncated:
  // a caller that sends 200 would otherwise be told 10 were handled and have
  // no way to tell which.
  if (picks.length > INVITE_CHUNK_SIZE) {
    return { error: `Send up to ${INVITE_CHUNK_SIZE} at a time.` };
  }

  const cleanNote = clampLen(note, MAX_NOTE) || null;
  const admin = createAdminClient();

  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select(
      "campaign_id, title, status, application_deadline, campaign_end_date, description, brand_id, brand_invitation_id, brand_profiles(brand_name, logo_url), brand_invitations(brand_name)",
    )
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (campErr) {
    logError("campaignInvite.campaign", campErr, { campaignId });
    return { error: "Could not load the campaign. Please try again." };
  }
  if (!campaign) return { error: "Campaign not found." };

  // Never invite somebody to something they cannot act on. The brand side
  // closed exactly these two gates for exactly this reason: a creator who
  // gets a push for a campaign its own page calls Closed has been handed a
  // dead end, and a live one is only a deadline extension away.
  const gate = inviteBlockedReason(campaign.status, campaign.application_deadline, campaign.campaign_end_date);
  if (gate) return { error: gate };

  const rl = await enforceRateLimit({
    action: "campaign_invite",
    actorId,
    limit: CALL_LIMIT,
    windowSec: CALL_WINDOW_SEC,
    target: `${picks.length} creators · ${String(campaign.title || "").slice(0, 60)} (${campaignId.slice(0, 36)})`,
  });
  if (!rl.allowed) return { error: "You're sending campaign invites too quickly. Try again later." };

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const camp = campaign as any;
  const brandName: string | undefined =
    camp.brand_profiles?.brand_name || camp.brand_invitations?.brand_name || undefined;
  const logo = camp.brand_profiles?.logo_url;
  const brandLogoUrl = typeof logo === "string" && logo.startsWith("http") ? logo : null;
  const meta = campaignMeta(campaign.description);
  const banner = meta.banner_image;
  const bannerUrl = typeof banner === "string" && banner.startsWith("http") ? banner : null;
  const deadline = prettyDate(campaign.application_deadline);
  const deadlineLine = deadline ? `Applications close on ${deadline}` : null;
  const title = String(campaign.title || "a campaign");

  const profileIds = [...new Set(picks.map((p) => p.influencerId).filter(Boolean) as string[])];
  // A pick carrying BOTH ids is a registered creator whose invitation was
  // claimed. The profile wins: it is the only record that can receive an
  // in-app notification, and handling them twice would email them twice.
  const invitationIds = [
    ...new Set(picks.filter((p) => !p.influencerId && p.invitationId).map((p) => p.invitationId as string)),
  ];

  const out: InviteResult = {
    notified: 0,
    emailed: 0,
    alreadyInvited: 0,
    noChannel: 0,
    skipped: 0,
    emailFailed: 0,
  };

  const render = (fullName: string, registered: boolean, handle: string) =>
    renderCampaignInviteEmail({
      fullName,
      campaignTitle: title,
      brandName,
      ctaUrl: registered ? campaignUrl(campaignId) : signupUrl(handle),
      registered,
      note: cleanNote,
      bannerUrl,
      brandLogoUrl,
      deadlineLine,
    });

  // ── Registered creators ───────────────────────────────────────────────
  if (profileIds.length > 0) {
    const [profRes, invRes, appRes] = await Promise.all([
      admin
        .from("influencer_profiles")
        .select("influencer_id, full_name, username, instagram_handle, email, status")
        .in("influencer_id", profileIds),
      admin.from("campaign_invitations").select("influencer_id").eq("campaign_id", campaignId).in("influencer_id", profileIds),
      admin.from("campaign_applications").select("influencer_id").eq("campaign_id", campaignId).in("influencer_id", profileIds),
    ]);
    if (profRes.error) {
      logError("campaignInvite.profiles", profRes.error, { campaignId });
      return { error: "Could not load those creators. Please try again." };
    }
    // A ledger read that FAILED must not read as "nobody has been invited" —
    // that is the one error here that causes a duplicate push.
    if (invRes.error) {
      logError("campaignInvite.ledger", invRes.error, { campaignId });
      return { error: "Could not check who has already been invited. Please try again." };
    }
    const already = new Set((invRes.data || []).map((r) => String(r.influencer_id)));
    const applied = new Set((appRes.data || []).map((r) => String(r.influencer_id)));
    const byId = new Map((profRes.data || []).map((p) => [String(p.influencer_id), p]));

    const targets: { id: string; name: string; handle: string; email: string | null }[] = [];
    for (const id of profileIds) {
      const p = byId.get(id);
      if (!p || p.status === "pending_deletion") {
        out.skipped = (out.skipped || 0) + 1;
        continue;
      }
      if (applied.has(id)) {
        out.skipped = (out.skipped || 0) + 1;
        continue;
      }
      if (already.has(id)) {
        out.alreadyInvited = (out.alreadyInvited || 0) + 1;
        continue;
      }
      const handle = p.instagram_handle || p.username || "";
      targets.push({
        id,
        name: p.full_name || handle || "there",
        handle,
        email: p.email && isEmail(String(p.email)) ? String(p.email).trim() : null,
      });
    }

    if (targets.length > 0) {
      // The tracking row goes in FIRST and is the claim: it is what makes
      // `apply-campaign` able to flip this to 'responded', what keeps the
      // campaign visible in their list, and what stops the next admin
      // sending the same invite. Written with ignoreDuplicates so two
      // overlapping runs cannot create two rows for one person.
      //
      // brand_id is NOT NULL and 72 of our 79 campaigns are admin-created
      // with no brand account at all, so for those it carries the BRAND
      // INVITATION id. The column has no foreign key and nothing filters on
      // it; its only consumer is the RLS policy `brand_id = auth.uid()`,
      // which an invitation id can never satisfy — so this widens nobody's
      // access, and it keeps the row self-describing rather than inventing a
      // placeholder uuid.
      const ownerId = campaign.brand_id || campaign.brand_invitation_id;
      if (!ownerId) {
        return { error: "This campaign has no brand on it, so an invite cannot be recorded against it." };
      }
      const { error: insErr } = await admin.from("campaign_invitations").upsert(
        targets.map((t) => ({
          campaign_id: campaignId,
          brand_id: ownerId,
          influencer_id: t.id,
          status: "sent",
        })),
        { onConflict: "campaign_id,influencer_id", ignoreDuplicates: true },
      );
      if (insErr) {
        logError("campaignInvite.insert", insErr, { campaignId, count: targets.length });
        return { error: "Could not record the invitations, so nothing was sent. Please try again." };
      }

      // One insert, one push each. The creator's own `campaignUpdates`
      // preference is honoured by the 055 trigger, which drops the
      // notification row and leaves the invitation — so tracking stays
      // complete for somebody who muted campaign alerts.
      const landed = await notifyUsers(
        targets.map((t) => ({
          userId: t.id,
          type: "campaign_invite",
          title: "You've been invited to a campaign",
          body: {
            text: `${brandName ? `${brandName} — ` : ""}you've been picked for "${title}". Apply before it closes.`,
            link: `/influencer/offers/${campaignId}`,
            campaignId,
          },
        })),
        "campaignInvite",
      );
      if (landed) out.notified = targets.length;

      await Promise.allSettled(
        targets.map(async (t) => {
          if (!t.email) return;
          try {
            const { subject, html, text } = render(t.name, true, t.handle);
            await sendMail({ to: t.email, subject, html, text });
            out.emailed = (out.emailed || 0) + 1;
          } catch (e) {
            out.emailFailed = (out.emailFailed || 0) + 1;
            logError("campaignInvite.email", e, { campaignId, influencerId: t.id });
          }
        }),
      );
    }
  }

  // ── Invited, not signed up ────────────────────────────────────────────
  //
  // Email is the only channel: there is no account to notify and no device
  // to push to. So the order is reversed here — the email goes FIRST and the
  // notes marker is written only once it has left. Marking first and failing
  // to send would record somebody as contacted who never was, and the marker
  // is what stops anyone trying again.
  if (invitationIds.length > 0) {
    const { data: invites, error: invErr } = await admin
      .from("influencer_invitations")
      .select("id, full_name, instagram_username, notes, status")
      .in("id", invitationIds);
    if (invErr) {
      logError("campaignInvite.invitations", invErr, { campaignId });
      return { ...out, error: "Could not load the invited creators. Please try again." };
    }
    const byId = new Map((invites || []).map((i) => [String(i.id), i]));

    for (const id of invitationIds) {
      const inv = byId.get(id);
      if (!inv || inv.status !== "pending") {
        out.skipped = (out.skipped || 0) + 1;
        continue;
      }
      const invMeta = invitationMeta(inv.notes);
      const map = inviteMapFromMeta(invMeta);
      if (map[campaignId]) {
        out.alreadyInvited = (out.alreadyInvited || 0) + 1;
        continue;
      }
      const email = typeof invMeta.email === "string" && isEmail(invMeta.email.trim()) ? invMeta.email.trim() : null;
      if (!email) {
        out.noChannel = (out.noChannel || 0) + 1;
        continue;
      }
      const handle = inv.instagram_username || "";
      try {
        const { subject, html, text } = render(inv.full_name || handle || "there", false, handle);
        await sendMail({ to: email, subject, html, text });
        out.emailed = (out.emailed || 0) + 1;
      } catch (e) {
        out.emailFailed = (out.emailFailed || 0) + 1;
        logError("campaignInvite.inviteEmail", e, { campaignId, invitationId: id });
        continue;
      }
      // Read-merge-write, and the whole map at once: mergeNotes is a
      // TOP-LEVEL merge, so handing it a one-key object would replace every
      // other campaign already recorded there. The rest of the trailer —
      // followers, bio, city, the keys the HikerAPI enrichment owns and the
      // featured-creator pickers read — survives because mergeNotes keeps
      // what it is not given.
      const { error: upErr } = await admin
        .from("influencer_invitations")
        .update({
          notes: mergeNotes(inv.notes, {
            [INVITE_NOTES_KEY]: { ...map, [campaignId]: new Date().toISOString() },
          }),
        })
        .eq("id", id);
      if (upErr) {
        // The email is already gone. Log it and move on: the only cost is
        // that this creator may be offered again, which an admin can see.
        logError("campaignInvite.mark", upErr, { campaignId, invitationId: id });
      }
    }
  }

  return out;
}
