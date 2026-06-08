-- Admin roles by PERSONAL DEVICE + master password (no email / no Supabase Auth).
--
-- Admin access = a personal device (any id NOT starting with ROSTER-) whose member
-- holds a role here, gated by the master password. The master password is NOT stored
-- in the DB — it lives at the top of the edge function code
-- (supabase/functions/attendance-api/auth.ts → MASTER_PASSWORD), so rotating it is a
-- one-line change. Roles attach to a member (so all of that person's personal devices
-- count) and NEVER to ROSTER-## seed stubs.
--
-- SAFE TO APPLY EARLY: additive (new table). Role rows are seeded by the backfill
-- (20260619) for personal-device admins only. Validate free-tier (rollback probe / CI).

CREATE TABLE IF NOT EXISTS member_roles (
  member_id  uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name text DEFAULT '',
  subgroup   text DEFAULT '',
  ministry   text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
