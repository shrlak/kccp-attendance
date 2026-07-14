-- Initial D1 schema, translated from the live Supabase Postgres schema (introspected
-- 2026-07-14) for the tables the current React app actually reads/writes. See
-- cloudflare/README.md for the Postgres -> SQLite translation rules applied here.
-- `events`/`event_attendees` are intentionally omitted: 0 rows in prod, referenced only
-- by legacy routes the web app never calls.

PRAGMA foreign_keys = ON;

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  subgroup TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  member_role TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  birth_date TEXT,
  baptism_status TEXT NOT NULL DEFAULT '해당없음',
  school_or_work TEXT NOT NULL DEFAULT '',
  faith_duration TEXT NOT NULL DEFAULT '',
  registration_date TEXT,
  pastoral_visit_requested INTEGER,
  is_new_member INTEGER NOT NULL DEFAULT 0,
  new_member_edu_week1 INTEGER NOT NULL DEFAULT 0,
  new_member_edu_week2 INTEGER NOT NULL DEFAULT 0,
  kakao_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT,
  is_staff INTEGER NOT NULL DEFAULT 0,
  status_note TEXT NOT NULL DEFAULT '',
  status_start TEXT,
  status_end TEXT
);
CREATE UNIQUE INDEX members_email_unique ON members (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  subgroup TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  member_role TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  gender TEXT,
  phone TEXT,
  birth_date TEXT,
  baptism_status TEXT DEFAULT '해당없음',
  school_or_work TEXT,
  faith_duration TEXT,
  registration_date TEXT,
  pastoral_visit_requested INTEGER NOT NULL DEFAULT 0,
  is_new_member INTEGER NOT NULL DEFAULT 1,
  new_member_edu_week1 INTEGER NOT NULL DEFAULT 0,
  new_member_edu_week2 INTEGER NOT NULL DEFAULT 0,
  kakao_id TEXT NOT NULL DEFAULT '',
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE
);
CREATE INDEX idx_devices_member_id ON devices(member_id);

CREATE TABLE attendance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  name TEXT,
  group_name TEXT NOT NULL DEFAULT '',
  subgroup TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  time_str TEXT,
  ts INTEGER,
  location_verified INTEGER NOT NULL DEFAULT 0,
  admin_added INTEGER NOT NULL DEFAULT 0,
  first_visit INTEGER NOT NULL DEFAULT 0,
  is_manual INTEGER NOT NULL DEFAULT 0,
  is_bulk INTEGER NOT NULL DEFAULT 0,
  is_guest INTEGER NOT NULL DEFAULT 0,
  member_role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX idx_attendance_log_member_id ON attendance_log(member_id);
CREATE INDEX idx_attendance_log_date ON attendance_log(date);

CREATE TABLE member_roles (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name TEXT NOT NULL DEFAULT '',
  subgroup TEXT NOT NULL DEFAULT '',
  ministry TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Singleton settings row (id=1). Only the columns the live (ported) routes touch —
-- the legacy admin_devices/name_order/admin_password columns are dropped along with
-- the legacy routes that used them.
CREATE TABLE config (
  id INTEGER PRIMARY KEY,
  checkin_days TEXT NOT NULL DEFAULT '[0]',
  checkin_start_min INTEGER NOT NULL DEFAULT 780,
  checkin_end_min INTEGER NOT NULL DEFAULT 900,
  dongsan_names TEXT NOT NULL DEFAULT '{"대학부":["동산1","동산2","동산3","동산4"],"청년부":["동산1","동산2","동산3","동산4"]}',
  dongsan_leaders TEXT NOT NULL DEFAULT '{}',
  officers TEXT NOT NULL DEFAULT '[]',
  require_approval INTEGER NOT NULL DEFAULT 0,
  announcement TEXT NOT NULL DEFAULT '',
  summer_mode INTEGER NOT NULL DEFAULT 0,
  demo_mode INTEGER NOT NULL DEFAULT 0,
  individual_checkin_enabled INTEGER NOT NULL DEFAULT 0,
  pending_clear TEXT NOT NULL DEFAULT '[]',
  group_colors TEXT NOT NULL DEFAULT '{"대학부":"#E0A800","청년부":"#3B82F6"}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO config (id) VALUES (1);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  action TEXT,
  admin_id TEXT,
  admin_name TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  role TEXT NOT NULL,
  member_id TEXT, -- intentionally not FK'd: history must survive member delete/merge
  member_name TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'password',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_log_ts ON login_log(ts DESC);

CREATE TABLE pending_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL UNIQUE,
  name TEXT,
  group_name TEXT NOT NULL DEFAULT '',
  subgroup TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL DEFAULT (datetime('now'))
);
