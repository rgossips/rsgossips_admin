-- Who signs off on an agreed outreach price.
--
-- A FLAG, not a name in code. The person doing this today is Saquib
-- Siddiqui, but hardcoding that would mean editing and redeploying the
-- portal the day they go on leave or the responsibility moves — and a
-- string comparison against a display name would break the moment someone
-- fixes a typo in it. Any number of admins can hold the flag; the portal
-- routes a newly agreed price to one of them and lists the others.
--
-- Deliberately not a new role. The three roles (super_admin / admin /
-- viewer) are an authorisation boundary that gates every server action;
-- "approves outreach prices" is a job, not a permission level, and adding a
-- fourth role would mean revisiting every gate in require-super-admin.ts.
ALTER TABLE public.admin_profiles
  ADD COLUMN IF NOT EXISTS is_outreach_approver boolean NOT NULL DEFAULT false;

-- Starting value, matched on email because that is the stable identifier.
-- Idempotent, and a no-op on any database where that admin does not exist
-- (a fresh environment, or after they are removed).
UPDATE public.admin_profiles
   SET is_outreach_approver = true
 WHERE lower(email) = 'imsaquib.siddiqui@gmail.com';

COMMENT ON COLUMN public.admin_profiles.is_outreach_approver IS
  'Receives agreed outreach prices for sign-off. A job, not a permission level — see 005_outreach_approver.sql.';
