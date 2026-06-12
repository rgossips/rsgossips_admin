# Security Plan — RecentGossips Admin

A prioritized hardening plan for this stack:

- **Frontend / server actions:** Next.js (this repo, `rgossips-admin`)
- **DB + Auth:** Supabase (Postgres + GoTrue)
- **Payments:** Razorpay (India) + Stripe (international)
- **Hosting:** Netlify

Items are grouped by urgency, not by category — the goal is to fix the highest-impact gaps first and let the rest land over time. Each item answers: *what*, *why*, *how*.

---

## Tier 1 — do this week

These are the cheapest changes with the largest blast-radius impact. If we only ever did Tier 1, we'd close ~80% of the realistic attack surface for a stack like this.

### 1.1 Lock down Supabase Row-Level Security (RLS)

**Why:** the public anon key is in the browser bundle. RLS is the *only* thing stopping anyone from reading or writing every public table. RLS being off or wrong is the single biggest risk in this stack.

**How:**

- Audit every public-facing table:
  ```sql
  SELECT relname, relrowsecurity
  FROM pg_class
  WHERE relkind = 'r'
    AND relnamespace = 'public'::regnamespace
  ORDER BY relname;
  ```
  Any row with `relrowsecurity = false` is open to the world.
- For every table that has RLS enabled, list its policies:
  ```sql
  SELECT schemaname, tablename, policyname, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public';
  ```
  Write a separate policy per `cmd` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) — broad `FOR ALL` policies are easy to get wrong.
- Default-deny: enable RLS first, then add explicit allow policies. Never rely on policy absence.
- The service role key **bypasses RLS**. Confirm with `grep`:
  ```bash
  grep -rn "SUPABASE_SERVICE_ROLE_KEY" src/
  ```
  Every hit must be in a `"use server"` file, an edge function, or a `/lib/*` module that is only imported by server code. If any client component imports it (directly or transitively), it's leaked into the browser bundle.

### 1.2 Verify payment webhook signatures

**Why:** a missing signature check means an attacker can `POST` a forged "payment succeeded" event and unlock paid features for free. Both Razorpay and Stripe expect signature verification — it's not optional.

**How — Stripe:**

```ts
// Read RAW body, not parsed JSON
const rawBody = await req.text();
const sig = req.headers.get("stripe-signature")!;
const event = stripe.webhooks.constructEvent(
  rawBody,
  sig,
  process.env.STRIPE_WEBHOOK_SECRET!,
);
```

If you parse JSON before verifying, the signature will never match. In Next.js App Router, that means the route handler must use `req.text()` (not `req.json()`).

**How — Razorpay:**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const sig = req.headers.get("x-razorpay-signature")!;
const expected = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
  .update(rawBody)
  .digest("hex");
if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
  return new Response("bad sig", { status: 400 });
}
```

Use `timingSafeEqual`, not `===` — string comparison is timing-attack vulnerable.

**Beyond signatures:**

- Never derive `amount` / `currency` from the webhook payload. Look up your own order record by ID, confirm the canonical amount matches what was charged. Reject if it doesn't.
- Idempotency: store the event ID (`event.id` for Stripe, `payload.payment.entity.id` for Razorpay) in a `processed_webhooks` table and ignore duplicates. Both providers retry on non-2xx responses.
- Don't apply session middleware to webhook routes — they authenticate themselves via signature, not cookies.
- Log signature failures to a separate channel and alert on bursts (recon attempt).

### 1.3 HTTP security headers via Netlify

**Why:** these stop entire classes of attacks (clickjacking, MIME sniffing, mixed content, etc.) with a single config file. There's no downside.

**How:** create `netlify.toml` at the repo root, or `public/_headers`:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Strict-Transport-Security = "max-age=63072000; includeSubDomains; preload"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    X-Frame-Options = "DENY"
```

**Content-Security-Policy** is the most powerful and the most painful — roll it out carefully:

1. Start with `Content-Security-Policy-Report-Only` so violations are reported but not blocked.
2. Pipe reports to a service (Sentry, report-uri.com, or your own endpoint).
3. Watch for a week, adjust the policy until reports are clean.
4. Flip to enforcing `Content-Security-Policy`.

Initial sketch (you'll tune the `connect-src` to include Supabase, Razorpay, Stripe):

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://js.stripe.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.supabase.co;
connect-src 'self' https://*.supabase.co https://api.razorpay.com https://api.stripe.com;
frame-src https://api.razorpay.com https://js.stripe.com;
frame-ancestors 'none';
```

Once stable, kill `'unsafe-inline'` for scripts by adopting nonce-based CSP (Next.js supports this since v13).

### 1.4 Protect Netlify preview / branch deploys

**Why:** preview URLs leak via PR comments, Slack, etc. They typically point to a deploy that has production-shaped secrets but no rate limiting, no MFA, no abuse monitoring. They're often forgotten.

**How:**

- In Netlify → Site → Build & deploy → Deploy contexts: disable deploy previews entirely, OR
- Enable Netlify's basic-auth password protection on non-production contexts (`netlify.toml` → `[context.deploy-preview.environment]` and use Netlify's "Visitor access" feature).
- Use separate environment variables per context — preview should never read production secrets.

---

## Tier 2 — within a month

### 2.1 Admin panel hardening

**Why:** super-admin accounts can delete users, change roles, send transactional email. They deserve more protection than a regular user.

**How:**

- **MFA on super_admin.** Supabase Auth supports TOTP — `supabase.auth.mfa.enroll`. Require it in the dashboard layout before allowing any super-admin action.
- **Shorter admin session.** Set a shorter refresh-token expiry on the admin-app Supabase client. End-user sessions can be days; admin sessions should be hours.
- **Audit log.** Add an `admin_audit_log` table. Write on every mutating action: `(user_id, action, target_table, target_id, before_json, after_json, occurred_at)`. Read-only — never editable from the UI. Detects compromised accounts and gives you a paper trail.
- **Admin route IP allow-list.** If your ops team has stable IPs (office, VPN), gate `/dashboard/admins` and the delete actions behind a Netlify Edge Function that checks `request.headers["x-forwarded-for"]` against an allowlist.

### 2.2 Rate-limit your own server actions

**Why:** Supabase has built-in rate limiting for its auth endpoints, but your custom server actions (invite, send-email, login, password reset) don't. An attacker can brute-force invites or harvest emails without any throttle.

**How:**

- Use Upstash Redis (free tier is enough) or Vercel KV-style edge storage.
- Wrap rate-sensitive actions with a small helper:
  ```ts
  await rateLimit({ key: `invite:${ip}`, limit: 5, windowSec: 60 });
  ```
- Especially:
  - Login (5 attempts / 5 min / IP, plus a slower per-account limit)
  - Send invite email (5 / min / IP, 50 / day / admin)
  - Password reset (3 / hour / email)
  - Bulk invite (1 / min / admin)

### 2.3 Input validation at boundaries

**Why:** the action files in this repo currently do ad-hoc `as string` casts on every `formData.get(...)`. One unchecked input can lead to storage path manipulation, SQL injection (via raw queries), or weird state if a number field receives a string of `"NaN"`.

**How:**

- Adopt Zod (or Valibot) at the boundary. Define a schema per action, parse `formData` once, throw on invalid.
- Pattern:
  ```ts
  const schema = z.object({
    title: z.string().min(1).max(200),
    budget_total: z.coerce.number().int().nonnegative(),
    target_categories: z.array(z.string()).min(1),
  });
  const data = schema.parse(Object.fromEntries(formData));
  ```
- File uploads:
  - Server-side MIME re-check (don't trust the `Content-Type` header — read the magic bytes).
  - Enforce max size *before* reading the buffer (`file.size > MAX` → reject).
  - Prefix all storage paths with a server-generated UUID. *(Already done — keep it.)*

### 2.4 Email link / open-redirect safety

**Why:** transactional emails contain `redirect_to` parameters. If those aren't validated, an attacker can craft an invite link that auths the user then bounces them to `evil.com` to phish a password.

**How:**

- In `getSiteUrl()` and any place that builds an auth callback URL, validate the redirect target is on your own domain.
- Allowlist approach: maintain a list of allowed hosts and reject any `redirect_to` not in the list. Never blindly take a URL from the query string.

---

## Tier 3 — defense in depth

### 3.1 Secrets hygiene

- Enable GitHub secret scanning + push protection on the repo.
- Rotate any keys that have ever been committed — assume git history is public.
- SMTP credentials live exclusively in Supabase Edge Function secrets, never in this app's env vars. *(Already enforced — keep it.)*
- Use distinct keys per environment. Where Supabase doesn't allow this directly (one service role per project), use the JWT signing approach with a custom `env` claim.

### 3.2 Database backups + PITR

- Subscribe to Supabase Pro for point-in-time recovery. If someone runs a destructive `DELETE` without `WHERE`, you'll want to roll back to 30 seconds ago.
- Test the restore flow once before you need it. Document it.

### 3.3 Error monitoring

- Sentry (or similar) on Next.js and Supabase Edge Functions.
- Most early attack signals look like "unusual error rate" before they look like an actual compromise. Wire up alerts for spikes in 4xx / 5xx, especially on auth and webhook routes.

### 3.4 Dependency hygiene

- Enable Dependabot security updates on this repo.
- `npm audit --production` in CI; fail on high/critical.
- Upgrade Next.js minor versions on a schedule (monthly) rather than reactively.
- Keep `@supabase/*` packages current — they ship auth-relevant fixes.

### 3.5 CSP refinement

Once basic CSP is enforced (1.3), iterate:

- Drop `'unsafe-inline'` for `script-src` by adopting nonce-based CSP. Next.js 13+ supports this in middleware. Kills entire classes of XSS.
- Tighten `connect-src` and `frame-src` to exact subdomains rather than wildcards.
- Add `require-trusted-types-for 'script'` once the code is ready — strongest defense against DOM-based XSS.

### 3.6 Payment-specific hardening (beyond Tier 1)

- Never store full card numbers. Use Razorpay / Stripe tokens only.
- Webhook routes on a separate path pattern (`/api/webhooks/*`) so you can apply per-path policies in Netlify / middleware.
- Log webhook signature failures to a queue + alert. Repeated failures from the same IP are recon.
- Use Razorpay's "Allowed IP" feature for webhook origin restriction. Stripe has a similar IP allowlist (their published IP ranges).

### 3.7 Auth UX as security

- Sign-in pages should not reveal whether an email is registered (no "user not found" vs "wrong password" leak).
- Password reset flows always respond `200 OK` regardless of whether the email exists — prevents account enumeration.
- After N failed logins, require captcha (Supabase supports hCaptcha integration).

---

## What to start with this afternoon

The three things that close the most surface in the least time:

1. **Audit RLS.** Run the SQL in 1.1 and look for any `relrowsecurity = false` rows on public tables.
2. **Add Netlify security headers.** One file, ten minutes (see 1.3).
3. **Confirm payment signature verification.** Read the two webhook handlers and confirm they use `constructEvent` / `timingSafeEqual` against the raw body.

If those three pass, everything in Tier 2 and Tier 3 becomes an incremental improvement rather than a panic.

---

## References

- Supabase RLS guide: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Stripe webhook verification: <https://stripe.com/docs/webhooks/signatures>
- Razorpay webhook verification: <https://razorpay.com/docs/webhooks/validate-test/>
- Netlify headers + security: <https://docs.netlify.com/routing/headers/>
- MDN CSP guide: <https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP>
- OWASP cheat sheet for Next.js apps: <https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html>
