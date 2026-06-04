// Thin client for the `send-email` Supabase Edge Function. We do NOT
// touch SMTP from the Next.js admin app — credentials live exclusively
// in Supabase Edge Function secrets so they never end up in this app's
// env vars or bundled code.
//
// The Edge Function verifies the caller's JWT, so we authenticate with
// the service-role key (already required by other admin actions).

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  fromName?: string;
}

export async function sendMail(opts: SendMailOptions): Promise<{ messageId?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase URL or service-role key not configured — cannot reach send-email function.",
    );
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The edge function (with verify_jwt on) requires a JWT.
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify(opts),
  });

  // The function returns 200 even on errors (with { error } in the body)
  // so always parse and inspect.
  let body: { success?: boolean; error?: string; messageId?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok || body.error) {
    throw new Error(body.error || `send-email returned HTTP ${res.status}`);
  }
  return { messageId: body.messageId };
}
