-- Admin roles by PERSONAL DEVICE + master password (no email / no Supabase Auth).
--
-- Per the chosen model: admin access = a personal device (any id that is NOT a
-- ROSTER-## seed stub) whose member holds a role, gated by the shared master
-- password. Roles attach to a member (so all of that person's personal devices
-- count) and NEVER to ROSTER placeholders.
--
-- This replaces the legacy config.admin_devices JSONB blob with a real table keyed
-- by member_id, and replaces the plaintext config.admin_password with a bcrypt hash.
--
-- SAFE TO APPLY EARLY: additive (new table + column + function). Seeding roles and
-- setting the password hash happens at cutover. Validate on a Supabase branch
-- (free-tier: local `supabase start`).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS member_roles (
  member_id  uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name text DEFAULT '',
  subgroup   text DEFAULT '',
  ministry   text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Hashed master password (replaces plaintext config.admin_password). Set at cutover:
--   UPDATE config SET admin_password_hash = crypt('<master password>', gen_salt('bf')) WHERE id = 1;
ALTER TABLE config ADD COLUMN IF NOT EXISTS admin_password_hash text;

-- Server-side password check (SECURITY DEFINER so it works under RLS). The edge
-- function calls this via RPC; the plaintext password never leaves the request.
CREATE OR REPLACE FUNCTION check_admin_password(pw text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT c.admin_password_hash IS NOT NULL
     AND c.admin_password_hash = crypt(pw, c.admin_password_hash)
  FROM config c WHERE c.id = 1;
$$;
REVOKE ALL ON FUNCTION check_admin_password(text) FROM anon, authenticated;
