-- Stable member identity (spec D4 / plan Phase A2) — STRUCTURE ONLY.
--
-- Introduces `members` with a surrogate UUID key so a person is no longer keyed by
-- their name string (the 김서현 collision). `devices` and `attendance_log` gain a
-- member_id FK; name becomes a mutable attribute of `members`. A member may own many
-- devices. The data backfill is a SEPARATE migration (plan Task A4) because it depends
-- on the human-resolved collision report (plan Task A3).
--
-- SAFE TO APPLY EARLY: purely additive (new table + nullable columns). No data moves
-- here. Validate on a Supabase branch before production (plan Phase A).

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  group_name text DEFAULT '',
  subgroup text DEFAULT '',
  notes text DEFAULT '',
  member_role text DEFAULT '',
  gender text DEFAULT '',
  phone text DEFAULT '',
  birth_date date,
  baptism_status text DEFAULT '해당없음',
  school_or_work text DEFAULT '',
  faith_duration text DEFAULT '',
  registration_date date,
  pastoral_visit_requested boolean DEFAULT false,
  is_new_member boolean DEFAULT false,
  new_member_edu_week1 boolean DEFAULT false,
  new_member_edu_week2 boolean DEFAULT false,
  kakao_id text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE devices        ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devices_member ON devices(member_id);
CREATE INDEX IF NOT EXISTS idx_attlog_member  ON attendance_log(member_id);
