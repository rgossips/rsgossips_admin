"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { adminGate, requireAdmin } from "@/lib/require-super-admin";
import { notifyUser } from "@/lib/notify";
import { sendMail } from "@/lib/mailer";
import { auditLog } from "@/lib/rate-limit";
import { friendlyDbError, logError } from "@/lib/log";
import { clampLen, isHttpUrl } from "@/lib/validation";
import { expectedArrival, normalizeShippingMode } from "@/lib/barter-fulfilment";

// Barter fulfilment, admin side: record where the product goes and, once it
// is on its way, the tracking link. Columns come from rgossips_web migration
// 076; the same migration has a trigger enforcing the two rules that matter
// (creators can't write tracking, nobody rewrites an address after dispatch),
// so these actions and the database agree rather than the UI being the only
// guard.

const ADDRESS_MAX = 600;
const CARRIER_MAX = 60;

// The campaign's shipping promise lives in the description trailer, not a
// column — same pattern as every other campaign field.
async function campaignShipping(campaignId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("campaigns").select("description, title, campaign_type").eq("campaign_id", campaignId).maybeSingle();
  let mode = "no";
  let timelineDays: number | null = null;
  const description = data?.description || "";
  const sep = description.indexOf("\n\n---\n");
  const jsonStr = sep !== -1 ? description.slice(sep + 5) : description.startsWith("{") ? description : "";
  if (jsonStr) {
    try {
      const meta = JSON.parse(jsonStr);
      mode = meta.shipping_required || "no";
      timelineDays = meta.shipping_timeline_days ?? null;
    } catch {
      /* a malformed trailer just means defaults */
    }
  }
  return { mode: normalizeShippingMode(mode), timelineDays, title: data?.title || "your campaign" };
}

export async function setShippingAddress(
  applicationId: string,
  address: string,
): Promise<{ error?: string; success?: boolean }> {
  const gate = await adminGate();
  if (gate) return gate;

  const clean = clampLen(address, ADDRESS_MAX).trim();
  if (!clean) return { error: "Enter the delivery address." };

  const admin = createAdminClient();
  const { data: app } = await admin
    .from("campaign_applications")
    .select("id, campaign_id, shipping_tracking_url")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { error: "Application not found." };
  // Same rule as the trigger, checked here so the admin gets a sentence
  // instead of a database exception.
  if (app.shipping_tracking_url) {
    return { error: "This has already shipped — the address can't be changed now." };
  }

  const { error } = await admin
    .from("campaign_applications")
    .update({ shipping_address: clean, shipping_address_updated_at: new Date().toISOString() })
    .eq("id", applicationId);
  if (error) return { error: friendlyDbError("fulfilment.address", error, "Could not save the address. Please try again.", { applicationId }) };

  revalidatePath(`/dashboard/campaigns/${app.campaign_id}`);
  return { success: true };
}

export async function setShippingTracking(
  applicationId: string,
  trackingUrl: string,
  carrier?: string,
): Promise<{ error?: string; success?: boolean; notified?: boolean }> {
  let actorId: string;
  try {
    actorId = await requireAdmin();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Forbidden" };
  }

  const url = clampLen(trackingUrl, 500).trim();
  if (!url) return { error: "Enter the tracking link." };
  if (!isHttpUrl(url)) return { error: "That doesn't look like a link — it should start with http:// or https://" };

  const admin = createAdminClient();
  const { data: app } = await admin
    .from("campaign_applications")
    .select("id, campaign_id, influencer_id, shipping_address, shipping_tracking_url")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { error: "Application not found." };

  const { mode, timelineDays, title } = await campaignShipping(app.campaign_id);
  if (mode === "no") return { error: "This campaign doesn't ship anything." };
  if (mode === "yes" && !app.shipping_address) {
    return { error: "Add the delivery address first — there's nowhere to send it." };
  }

  const now = new Date().toISOString();
  // Stored rather than derived: the campaign's timeline can be edited later,
  // and a promised arrival date that moves underneath the creator is worse
  // than none at all.
  const expected = expectedArrival(now, timelineDays);
  const isUpdate = !!app.shipping_tracking_url;

  const { error } = await admin
    .from("campaign_applications")
    .update({
      shipping_tracking_url: url,
      shipping_carrier: carrier ? clampLen(carrier, CARRIER_MAX).trim() : null,
      shipping_tracking_added_at: now,
      shipping_tracking_added_by: actorId,
      shipping_expected_at: expected,
    })
    .eq("id", applicationId);
  if (error) return { error: friendlyDbError("fulfilment.tracking", error, "Could not save the tracking link. Please try again.", { applicationId }) };

  await auditLog("barter_tracking_set", actorId, `${applicationId} ${isUpdate ? "updated" : "added"} ${url}`);

  // Tell the creator it's on its way. Best-effort on both channels — the
  // tracking link is saved either way.
  let notified = false;
  if (app.influencer_id) {
    try {
      await notifyUser(
        {
          userId: app.influencer_id,
          type: "app_shipped",
          title: "Your product is on its way",
          body: {
            text: `Your product for "${title}" has been dispatched. Tap to track it, and let us know when it arrives.`,
            link: `/influencer/offers/${app.campaign_id}`,
            campaignId: app.campaign_id,
            applicationId,
            trackingUrl: url,
          },
        },
        "barter-tracking",
      );
      notified = true;
    } catch (e) {
      logError("fulfilment.tracking.notify", e, { applicationId });
    }

    try {
      const { data: creator } = await admin
        .from("influencer_profiles")
        .select("full_name, username, email")
        .eq("influencer_id", app.influencer_id)
        .maybeSingle();
      if (creator?.email) {
        const name = (creator.full_name || creator.username || "there").split(" ")[0];
        const by = new Date(expected).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        // ASCII subject on purpose — see headerSafe() in the send-email
        // function for what a rupee sign or a smart quote does to a subject.
        await sendMail({
          to: creator.email,
          subject: `Your product for ${title} has shipped`.replace(/[^\x20-\x7E]/g, ""),
          html: `<p>Hi ${name},</p>
                 <p>Your product for <strong>${title}</strong> is on its way${carrier ? ` with ${carrier}` : ""}.</p>
                 <p><a href="${url}">Track your delivery</a></p>
                 <p>It should reach you by around <strong>${by}</strong>. Once it arrives, open the app and confirm you've received it — that's the last thing we need from you.</p>
                 <p>If it hasn't turned up by then, tell us in the app and we'll chase it.</p>`,
          text: `Hi ${name},\n\nYour product for ${title} is on its way${carrier ? ` with ${carrier}` : ""}.\n\nTrack it: ${url}\n\nIt should reach you by around ${by}. Once it arrives, open the app and confirm you've received it.\n\n- RGossips`,
        });
      }
    } catch (e) {
      logError("fulfilment.tracking.email", e, { applicationId });
    }
  }

  revalidatePath(`/dashboard/campaigns/${app.campaign_id}`);
  revalidatePath("/dashboard/payouts");
  return { success: true, notified };
}
