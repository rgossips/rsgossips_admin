import { type NextRequest } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { logError } from "@/lib/log";
import { verifyUnsubscribe } from "@/lib/nudges/send";

// Unsubscribe link in every creator nudge email. Public (no admin session) —
// excluded from the session redirect in utils/supabase/middleware.ts. The
// link carries an HMAC of the user id, so it can only opt out the creator it
// was sent to.
//
// GET only shows a confirm button; the POST does the opt-out. Mail scanners
// (Outlook Safe Links, Gmail) prefetch every link in an email, and a GET that
// unsubscribed would silently opt out creators who never clicked.

function page(title: string, body: string, form?: { u: string; s: string }) {
  const button = form
    ? `<form method="POST" style="margin-top:20px">
         <input type="hidden" name="u" value="${esc(form.u)}" />
         <input type="hidden" name="s" value="${esc(form.s)}" />
         <button type="submit" style="background:linear-gradient(135deg,#6366F1,#A855F7,#EC4899);color:#fff;border:0;border-radius:12px;padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button>
       </form>`
    : "";
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)} · RGossips</title></head>
<body style="margin:0;background:#F4F5F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937">
  <div style="max-width:460px;margin:64px auto;padding:32px;background:#fff;border-radius:20px;box-shadow:0 4px 24px rgba(99,102,241,.08);text-align:center">
    <div style="font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#7C3AED">RGossips</div>
    <h1 style="font-size:20px;margin:10px 0 8px">${esc(title)}</h1>
    <p style="font-size:15px;line-height:1.6;color:#4B5563;margin:0">${body}</p>
    ${button}
  </div>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const invalid = () => page("Link not valid", "This unsubscribe link is broken or has expired. Reply to any of our emails and we'll take you off the list.");

export async function GET(request: NextRequest) {
  const u = request.nextUrl.searchParams.get("u") || "";
  const s = request.nextUrl.searchParams.get("s") || "";
  if (!verifyUnsubscribe(u, s)) return invalid();
  return page("Unsubscribe from RGossips tips?", "You'll stop getting these tip and reminder emails and notifications. Messages about your campaigns and payments still come through.", { u, s });
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const u = String(form?.get("u") || "");
  const s = String(form?.get("s") || "");
  if (!verifyUnsubscribe(u, s)) return invalid();
  const { error } = await createAdminClient().from("creator_nudge_opt_outs").upsert({ user_id: u }, { onConflict: "user_id" });
  if (error) {
    logError("nudges.unsubscribe", error, { userId: u });
    return page("Something went wrong", "We couldn't save that just now. Please try the link again in a minute.");
  }
  return page("You're unsubscribed", "You won't get any more tip or reminder emails from us. Messages about your campaigns and payments still come through.");
}
