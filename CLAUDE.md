@AGENTS.md

# rgossips-admin — orientation for Claude

Read this before editing. It's a living document: **when you learn something non-obvious about this codebase in a session, add it here in the same commit** — the goal is that the next session picks up context in one read instead of relearning from scratch. Keep entries terse, prefer file:line pointers over prose.

---

## Stack

- **Next.js 16.2.1** with App Router + Server Actions (React 19.2). Breaking changes from earlier majors — see `AGENTS.md` and `node_modules/next/dist/docs/` before writing new code.
- **Supabase** (`@supabase/supabase-js` 2.100 + `@supabase/ssr` 0.9) — Postgres, GoTrue auth, Storage, Edge Functions. Two clients are used:
  - Session-bound: `@/utils/supabase/server` and `@/utils/supabase/client` — respect RLS.
  - Service role: `@/utils/supabase/admin` (`createAdminClient()`) — bypasses RLS, only ever imported from server code.
- **Tailwind CSS v4** with a `.dark` class variant (see `src/app/globals.css`). No `tailwind.config.js` — theme lives inline via `@theme inline` in the CSS.
- **Payments:** Razorpay (INR) + Stripe. Webhook signature verification is mandatory (see `docs/SECURITY.md`).
- **Hosting:** Netlify. `NEXT_PUBLIC_SITE_URL` is `https://rgossipsadmin.netlify.app/`.
- **Email:** custom `send-email` Supabase Edge Function only. **SMTP creds live exclusively in Edge Function secrets — never in this app's env vars.**

---

## Core conventions

### Server actions

- `"use server"` files: **every export becomes a callable ref on the client**. Non-function exports (constants, types, step lists) MUST live in sibling files, or Next.js replaces them with a callable at import time. Example: `delete-actions.ts` (server) + `delete-steps.ts` (plain module).
- Server actions return `Promise<{ error?: string; success?: boolean; ... }>`. When a client component narrows via `result.error`, the union must be widened via an explicit return-type annotation — otherwise TS complains that `error` isn't on the success branch. Pattern: `Promise<{ error?: string; url?: string }>` with both fields optional.
- Every mutating action gates via [src/lib/require-super-admin.ts](src/lib/require-super-admin.ts):
  - `adminGate()` → `{ error }` for admin / super-admin only, `null` on success.
  - `requireAdmin()` → throws or returns `userId` (used when the action needs the caller's id, e.g. `created_by`).
  - `superAdminGate()` / `requireSuperAdmin()` → super-admin only. Used for user deletion and admin management.

### Role-based access

Three roles: `super_admin`, `admin`, `viewer`.

- **super_admin** — everything, plus user deletion + admin management.
- **admin** — day-to-day CRUD, no destructive user deletion, no admin panel.
- **viewer** — read-only. UI hides write affordances; server actions reject.

Client-side: [src/components/role-context.tsx](src/components/role-context.tsx) exposes `useRole()` returning `{ role, isViewer, isAdmin, isSuperAdmin }`, plus `<AdminOnly>` / `<SuperAdminOnly>` wrappers. `RoleProvider` is mounted in [dashboard-shell.tsx](src/app/dashboard/dashboard-shell.tsx); the role is fetched in [dashboard/layout.tsx](src/app/dashboard/layout.tsx) alongside `full_name`.

Server-side: server components call `isAdminOrAbove()` / `isSuperAdmin()` from `require-super-admin.ts` to gate rendering. Create/edit routes for gated resources call `redirect("/dashboard/...")` at the top when the caller isn't authorized.

### Description / notes trailer metadata

Some rows pack extra fields into a text column's trailer as JSON to avoid schema churn:

- `campaigns.description` — cleaned prose, then `\n\n---\n{json}` with `banner_image`, `gallery_images`, `min_engagement_rate`, `platforms`, `target_gender`, `target_languages`, `offering_type`, `product_name`, `product_value`, `shipping_required`, `content_dos`, `content_donts`, `required_hashtags`, `brand_handles_to_tag`, `usage_rights`, `keepup_duration`, `exclusivity_days`, `payment_timeline`, etc. Parsed in the campaign detail page and the edit route.
- `brand_invitations.notes` / `influencer_invitations.notes` — same pattern, packs invitation metadata (category, instagram_verified for brands; city, gender, categories, languages, tags for influencers).

When adding fields, always append to metadata rather than adding columns — the pattern is intentional.

### Multi-step deletions

Destructive flows split into ordered steps so admins see per-step progress:

- Step keys live in `*-steps.ts` (plain module), step runner in `*-actions.ts` (`"use server"`).
- Ordering matters — FKs dictate the order (applications → campaigns → invitation, etc.).
- The `notify_user` step (sending the deletion email) runs FIRST and is wrapped in its own try/catch that always returns `ok: true` so SMTP issues don't block deletion.
- Two modals:
  - [DeleteUserModal](src/components/delete-user-modal.tsx) — has an internal trigger button, requires typing to confirm (used for full user deletion).
  - [DeleteWithStepsModal](src/components/delete-with-steps-modal.tsx) — controlled open state, parent owns the trigger, simple confirm-then-progress (used for invitation removal).

### Client component pitfalls

- **Never define subcomponents inside a client component that owns state.** React sees a new component identity on every render → remounts every child → focus loss + reset feel. Hoist `Card`, `Chip`, etc. to module scope. This was the cause of "form resets on typing" in the campaigns form.
- For submit buttons on server-action-style forms (`<form action={handleSubmit}>`): flip loading state at the very top of the handler (before validation), add an inline spinner, and use `disabled:cursor-wait` + `aria-busy`. See [create-campaign-form.tsx](src/app/dashboard/campaigns/create/create-campaign-form.tsx) submit button for the pattern.

### Confirm / prompt UX

- Prefer [ConfirmDialog](src/components/confirm-dialog.tsx) + `useConfirmDialog()` over native `confirm()`.
- For manual invite emails, [SendInviteEmailModal](src/components/send-invite-email-modal.tsx) collects the email + optional note and calls a gated action.

### Pagination

- [Pagination](src/components/pagination.tsx) is server-safe (`<Link>`s only), preserves other query params, takes a configurable `pageParam` so multiple paginated sections coexist. Pattern: query with `.range()` + `{ count: "exact" }`, pass total + current page + params through.
- Invited-brand and invited-influencer lists use `invite_page` at 12 cards per page.

### Phone numbers

Creators sign in by phone. `phone` lives on `auth.users`, **not** on `influencer_profiles`. Fetch via `admin.auth.admin.getUserById(id)` for details or bulk via `admin.auth.admin.listUsers({ page: 1, perPage: 1000 })` for list views. See [influencers/page.tsx](src/app/dashboard/influencers/page.tsx) for the list pattern.

### Cities / location (multi-select, comma-joined scalar)

- The influencer forms (invite, edit, invited-invitation edit) render **city/location as a multiselect** ([MultiSelectChips](src/components/multi-select-chips.tsx)) but persist it as a **comma-joined scalar string** — `metadata.city` on invitations, the `location` column on `influencer_profiles`. This is deliberate: a deployed RS_Gossips edge function (`brand-campaigns`) matches by substring (`city.includes(c) || c.includes(city)`) and `list-influencers` does `.toLowerCase()` on the value, so a JSON array would break them. Do not "normalize" to a single city or an array.
- [parseStoredCities()](src/lib/cities.ts) is the single owner of the split/normalize contract — splits on comma, keeps only known cities (case-insensitively → canonical), drops legacy free-text tokens like the country in "Mumbai, India". Use it to prefill the multiselect everywhere.
- [cities.ts](src/lib/cities.ts) intentionally keeps spelling **aliases** (Hubli/Hubli-Dharwad, Tiruchirappalli/Tiruchirapalli, plus Goa, Gulbarga) for back-compat with values saved under the older shorter list. Kept hand-synced with the web repo's `src/utils/indianCities.js` — mirror any edit there.

### Invitation → profile claim (cross-repo)

- Admin-curated invitation metadata (`creator_type`, `categories`, `gender`, `city`) is packed into `influencer_invitations.notes` and only becomes real profile columns when the creator **claims** the invitation — that copy happens in the **RS_Gossips `create-profile` edge function**, not here. If you add a field to the invite/edit form that must survive claim, update that edge function too or it silently drops on signup.
- **`updateInfluencerInvitation` must read-merge-write the notes trailer**, not rebuild it — the RS_Gossips enrichment script writes keys (`followers`, `bio`, …) the admin form doesn't know about, and the featured-creators / creator-stories pickers read `meta.followers`. A wholesale rebuild wipes them. See the merge in [influencers/actions.ts](src/app/dashboard/influencers/actions.ts).

### Email / SMTP

- [src/lib/mailer.ts](src/lib/mailer.ts) invokes the Supabase Edge Function `send-email` with the service-role JWT. It does NOT talk SMTP directly.
- SMTP creds (`SMTP_HOST=smtp.hostinger.com`, port 465, SMTPS) are stored ONLY as Supabase Edge Function secrets. Never add them to `.env` / Netlify env.
- Templates live in [src/lib/email-templates.ts](src/lib/email-templates.ts): `renderAdminInviteEmail`, `renderOnboardingInviteEmail` (kind: creator | brand), `renderUserStatusEmail` (suspended | reactivated), `renderUserDeletedEmail`. All use inline styles — email clients strip `<style>` tags.
- [getSiteUrl()](src/lib/site-url.ts) prefers `NEXT_PUBLIC_SITE_URL`, then `x-forwarded-host` header, then platform env, then `localhost:3000`.

### Storage buckets

Created on first upload via `createBucket()` calls in the upload actions (idempotent — bucket-exists errors are ignored):

- `campaign-images` — campaign banners, gallery, service images, creator-story videos (nested prefixes).
- `brand-icons` — brand logos.
- `influencer-photos` — creator profile photos.
- `featured-creator-avatars` — featured creator avatars.

Path prefix always includes a server-generated timestamp + short random suffix — never trust client filenames.

---

## Directory map

- `src/app/dashboard/` — one folder per feature route.
  - `actions.ts` — `"use server"` mutations for that feature.
  - `delete-actions.ts` + `delete-steps.ts` — multi-step delete flows (super_admin only).
  - `[id]/page.tsx` — detail page. `[id]/edit/page.tsx` — dedicated edit route (campaigns).
  - `_components/` or inline components colocated with routes.
- `src/lib/` — shared server-safe helpers (mailer, email templates, role gates, site URL, categories, cities).
- `src/components/` — shared UI (sidebar, header, role-context, dialogs, filter bar, pagination, spinner, avatar).
- `src/utils/supabase/` — client / server / admin factories.
- `docs/SECURITY.md` — hardening plan for the stack.

---

## Environment

The admin app relies on:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, never imported into a client component.
- `NEXT_PUBLIC_SITE_URL=https://rgossipsadmin.netlify.app/` on prod.
- Payment keys (Razorpay + Stripe) — server-only.

The Supabase project also hosts the `send-email` Edge Function with SMTP secrets.

---

## Recent working notes

Newest first. Add a bullet when you land something the next session should know about (a new subsystem, a non-obvious constraint, a bug you fixed that will bite again). Delete stale entries as they're normalized into the sections above.

- **Security boundary = the per-action gate, NOT the layout.** Server actions bypass the dashboard layout entirely, and this portal shares a Supabase project with the consumer app (so a non-admin CAN hold a valid session here). Therefore: EVERY exported server action must call a gate at the very top — `adminGate()`/`requireAdmin()` for writes + admin-only reads, `viewerGate()` for reads a viewer needs (returns a safe default on reject), `superAdminGate()`/`requireSuperAdmin()` for admin-management/deletes. An ungated action = direct PII leak. The dashboard [layout](src/app/dashboard/layout.tsx) now **fails closed** (bounded retry, then redirect) as defense-in-depth for page reads, but never rely on it for authz.
- **PostgREST filter injection:** any hand-built `.or("col.ilike.%${x}%")` string fed by user input (search boxes, `search` URL param) must run through [sanitizeSearchTerm()](src/lib/validation.ts) first — commas/parens/dots in the value otherwise inject extra OR predicates against the RLS-bypassing service client. Prefer parameterized `.ilike(col, val)` where possible.
- **Email links (invite/recovery) must use [getSiteUrl()](src/lib/site-url.ts)** which now trusts ONLY `NEXT_PUBLIC_SITE_URL`/platform env — the `x-forwarded-host` fallback was a host-header-injection → account-takeover vector and is dev-only now (throws in prod if unset).
- **Rate limiting + audit:** [enforceRateLimit()](src/lib/rate-limit.ts) (DB-backed, table `admin_activity_log`, migration 040 in RS_Gossips) guards abuse-prone actions — manual invite emails (30/admin/hr), bulk invite (60 calls/hr + hard 500-row/call cap), status emails (3/creator/hr). `auditLog()` records money actions (payout, plan change) with the acting admin id. Fails OPEN on limiter infra error (logs). Money actions resolve the actor via `requireAdmin()` — NEVER `admin.auth.getUser()` on the service client (no session → null, silently broke the referral/plan audit trail).
- **Errors + logging:** funnel Supabase errors through [friendlyDbError()/logError()](src/lib/log.ts) — raw `error.message` leaks schema internals; every failure should leave a `[scope]` log line for analysis. Security headers (CSP, HSTS, frame-ancestors none, nosniff) live in [netlify.toml](netlify.toml).
- Bulk invite (xlsx) is **client-chunked** to survive large files: [bulk-invite.tsx](src/components/bulk-invite.tsx) slices `parsedRows` into `CHUNK_SIZE` (200) and calls the server action once per chunk with a `startRow` offset, aggregating `{ success, failed }` and showing "Importing N of M". The old per-row (2 SELECT + 1 INSERT) loop timed out. Server actions (`bulkInviteInfluencers` / `bulkInviteBrands`) now: validate+normalize in memory → **one bulk existence check** via [fetchExistingHandles()](src/lib/bulk-invite-utils.ts) (batched case-insensitive `ilike` `or`-queries, escapes LIKE wildcards so `_` in handles isn't a wildcard) → **batch insert** survivors (per-row fallback only if the batch errors). Duplicates / already-registered / in-file repeats never halt the run — they land in `failed` and are listed at the end. There is **no DB unique constraint** on `instagram_username`, so dedup is app-level.
- Bulk influencer **gender** is lenient: [normalizeGender()](src/lib/bulk-invite-utils.ts) maps any spelling of male/female/non-binary to the canonical value and everything else (incl. blank) to `prefer_not_to_say` — gender is no longer a hard validation failure in bulk.
- Influencer city/location is now a comma-joined multiselect (see "Cities / location" above). [MultiSelectChips](src/components/multi-select-chips.tsx) is the shared picker — do NOT re-add a local copy inside a form (the invite form used to carry one and it drifted). It shows a search box when `options.length > 20` and resets that search on close.
- Sidebar was refactored from flat `mainNav` to grouped `navGroups` (Overview / Influencers / Brands / Operations). If you see a `ReferenceError: mainNav is not defined`, the render loop is out of sync with the data shape.
- Global scrollbar styling lives in `src/app/globals.css` — `color-scheme` + Firefox `scrollbar-color` + WebKit pseudo-elements, dark overrides gated on `.dark`. No component-level scrollbar CSS needed.
- Platform fees were removed from service quote requests. `platform_fee_amount` is still written as `0` for schema compatibility; UI copy no longer mentions a fee. If you re-introduce fees, update `sendQuote`, `acceptCounterOffer`, `QuoteResponseForm`, and the detail page summary card together.
- Application status on a campaign is admin-editable via a dropdown on the badge (any → any). The structured Approve+Pay / Reject+reason / Need-Revision flows still exist — the dropdown is for corrections.
- Campaign detail-actions is a status dropdown (draft ↔ active ↔ paused ↔ completed), not the old one-way buttons.
- Campaign create/edit share `CreateCampaignForm` — pass `initial: CampaignInitial` to edit. `updateCampaign` mirrors `createCampaign` field-for-field, allows brand reassignment. Edit route is `/dashboard/campaigns/[id]/edit`. `EditCampaignButton` is now a `<Link>`, not a modal opener.
- Invited-brand `Remove` cascades campaigns → applications → featured_campaigns → invitation, via `deleteBrandInvitationStep` + `BRAND_INVITATION_DELETE_STEPS`. Without the cascade, the delete trips `campaigns_brand_invitation_id_fkey`.
- Bulk-delete campaigns (super_admin only) via a `CampaignsTable` client component with checkboxes and a floating action bar.
- Admins page filter/search is client-side — the list is small enough that going to the server per keystroke was noticeably slow. Also has an inline role-change `<select>` on each row (blocks self-demotion).
- Sidebar name reads from `admin_profiles.full_name` (not the email prefix). Layout fetches `full_name` alongside role.

---

## When you update this doc

- Bump entries in "Recent working notes" for anything a fresh session couldn't infer from a `grep`.
- Promote entries to the relevant section above once they're stable and general (e.g. a one-off bug fix stays in the notes; a system-wide pattern moves up).
- Commit the CLAUDE.md update in the same commit as the code change it documents.
