// Delivery for creator nudges — shared by the manual Send button and the
// automatic job. Server-only.
//
// Each recipient gets:
//   * the email, when they have an address (sendMail → send-email edge fn);
//   * an in-app notification, always. That insert also fans out to web push
//     + FCM (rgossips_web migration 056), so it reaches the ~85% of creators
//     who never gave an email.
// One creator_nudge_sends row per recipient records what went out; the
// eligibility rules read it back, which is what stops repeats.
//
// NUDGE_SECRET (≥ 24 chars) signs unsubscribe links and authenticates the
// automatic job. Without it nothing is sent: a marketing email with no
// working unsubscribe link must not go out.

import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/utils/supabase/admin";
import { sendMail } from "@/lib/mailer";
import { notifyUsers } from "@/lib/notify";
import { logError } from "@/lib/log";
import { getSiteUrl } from "@/lib/site-url";
import type { NudgeKey } from "./constants";
import type { NudgeRecipient } from "./segments";
import { renderNudge } from "./templates";

const MIN_SECRET_LEN = 24;
const EMAIL_CONCURRENCY = 5;

export function nudgeSecret(): string | null {
  const s = process.env.NUDGE_SECRET || "";
  return s.length >= MIN_SECRET_LEN ? s : null;
}

function sign(userId: string, secret: string) {
  return createHmac("sha256", secret).update(`nudge-unsubscribe:${userId}`).digest("base64url");
}

export function verifyUnsubscribe(userId: string, sig: string): boolean {
  const secret = nudgeSecret();
  if (!secret || !userId || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(userId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `base` = getSiteUrl() — the unsubscribe route lives on this admin site. */
export function unsubscribeUrl(base: string, userId: string): string {
  const secret = nudgeSecret();
  const sig = secret ? sign(userId, secret) : "unconfigured";
  return `${base.replace(/\/+$/, "")}/api/nudges/unsubscribe?u=${encodeURIComponent(userId)}&s=${encodeURIComponent(sig)}`;
}

/** Bearer check for the automatic job, timing-safe. */
export function authorizedCron(header: string | null): boolean {
  const secret = nudgeSecret();
  if (!secret) return false;
  const given = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type NudgeSendResult = {
  userId: string;
  name: string;
  email: "sent" | "failed" | "none";
  inApp: boolean;
  error?: string;
};

export async function deliverNudge(
  key: NudgeKey,
  recipients: NudgeRecipient[],
  opts: { actorId: string | null; mode: "manual" | "auto" },
): Promise<NudgeSendResult[]> {
  if (recipients.length === 0) return [];
  if (!nudgeSecret()) throw new Error("NUDGE_SECRET is not set (min 24 characters) — unsubscribe links can't be signed.");

  const base = await getSiteUrl();
  const rendered = new Map(recipients.map((r) => [r.userId, renderNudge(key, r.vars, unsubscribeUrl(base, r.userId))]));
  const results = new Map<string, NudgeSendResult>(
    recipients.map((r) => [r.userId, { userId: r.userId, name: r.name, email: "none", inApp: false }]),
  );

  // Emails, a few at a time — the edge function is one SMTP send per call.
  const withEmail = recipients.filter((r) => r.email);
  for (let i = 0; i < withEmail.length; i += EMAIL_CONCURRENCY) {
    await Promise.all(
      withEmail.slice(i, i + EMAIL_CONCURRENCY).map(async (r) => {
        const msg = rendered.get(r.userId)!;
        const res = results.get(r.userId)!;
        try {
          await sendMail({ to: r.email!, subject: msg.subject, html: msg.html, text: msg.text, fromName: "RGossips" });
          res.email = "sent";
        } catch (e) {
          res.email = "failed";
          res.error = e instanceof Error ? e.message : String(e);
          logError("nudges.email", e, { key, userId: r.userId });
        }
      }),
    );
  }

  // In-app + push, one insert for the whole batch.
  const inAppOk = await notifyUsers(
    recipients.map((r) => {
      const msg = rendered.get(r.userId)!;
      return { userId: r.userId, type: "nudge", title: msg.push.title, body: { text: msg.push.text, link: msg.push.link, nudge: key } };
    }),
    "nudges",
  );
  for (const r of results.values()) r.inApp = inAppOk;

  // Record every recipient something reached, so they aren't nudged again.
  const rows = [...results.values()]
    .filter((r) => r.inApp || r.email === "sent")
    .map((r) => ({
      user_id: r.userId,
      nudge_key: key,
      channels: [...(r.email === "sent" ? ["email"] : []), ...(r.inApp ? ["inapp"] : [])],
      mode: opts.mode,
      sent_by: opts.actorId,
    }));
  if (rows.length) {
    const { error } = await createAdminClient().from("creator_nudge_sends").insert(rows);
    if (error) logError("nudges.record", error, { key, count: rows.length });
  }

  return [...results.values()];
}

export async function readAutoEnabled(): Promise<boolean | null> {
  const { data, error } = await createAdminClient()
    .from("creator_nudge_settings")
    .select("auto_enabled")
    .eq("id", true)
    .maybeSingle();
  if (error) return null; // migration 074 not applied
  return !!data?.auto_enabled;
}
