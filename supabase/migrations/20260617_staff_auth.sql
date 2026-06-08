-- Staff identity + Supabase Auth (spec D2 / plan Phase B1).
--
-- Replaces config.admin_password (plaintext) + config.admin_devices (device-keyed
-- roles) with auth.users-backed staff. A super admin invites by email; on first
-- magic-link / Google sign-in the invite is promoted to a staff row.
--
-- SAFE TO APPLY EARLY: additive tables + a trigger on auth.users that is a no-op
-- until invites exist. Validate on a Supabase branch (plan Phase B).

CREATE TABLE IF NOT EXISTS staff (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,   -- which member this staff *is* (동산지기 self-link)
  role text NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name text DEFAULT '',
  subgroup text DEFAULT '',
  ministry text DEFAULT '',
  email text,
  created_at timestamptz DEFAULT now()
);

-- Pending invites keyed by email; claimed on first sign-in.
CREATE TABLE IF NOT EXISTS staff_invites (
  email text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name text DEFAULT '',
  subgroup text DEFAULT '',
  ministry text DEFAULT '',
  member_id uuid REFERENCES members(id),
  created_at timestamptz DEFAULT now()
);

-- On first sign-in, promote a matching invite into a staff row, then consume it.
CREATE OR REPLACE FUNCTION claim_staff_invite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO staff (user_id, member_id, role, group_name, subgroup, ministry, email)
  SELECT NEW.id, i.member_id, i.role, i.group_name, i.subgroup, i.ministry, NEW.email
  FROM staff_invites i
  WHERE i.email = NEW.email
  ON CONFLICT (user_id) DO NOTHING;

  DELETE FROM staff_invites WHERE email = NEW.email;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION claim_staff_invite();
