-- Initial schema for KCCP attendance system
-- Creates all base tables so subsequent ALTER TABLE migrations work on fresh (preview) databases

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_name TEXT DEFAULT '',
    subgroup TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    member_role TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_log (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    name TEXT,
    group_name TEXT DEFAULT '',
    subgroup TEXT DEFAULT '',
    date DATE NOT NULL,
    time_str TEXT,
    ts BIGINT,
    location_verified BOOLEAN DEFAULT FALSE,
    admin_added BOOLEAN DEFAULT FALSE,
    first_visit BOOLEAN DEFAULT FALSE,
    is_manual BOOLEAN DEFAULT FALSE,
    is_bulk BOOLEAN DEFAULT FALSE,
    is_guest BOOLEAN DEFAULT FALSE,
    member_role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    ts BIGINT,
    action TEXT,
    admin_id TEXT,
    admin_name TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    admin_password TEXT DEFAULT 'kccpwelcome',
    admin_devices JSONB DEFAULT '[]',
    name_order JSONB DEFAULT '[]',
    dongsan_names JSONB DEFAULT '{"대학부": ["동산1", "동산2", "동산3", "동산4"], "청년부": ["동산1", "동산2", "동산3", "동산4"]}',
    checkin_days JSONB DEFAULT '[0]',
    checkin_start_min INTEGER DEFAULT 780,
    checkin_end_min INTEGER DEFAULT 900,
    dongsan_leaders JSONB DEFAULT '{}',
    require_approval BOOLEAN DEFAULT FALSE,
    announcement TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    summer_mode BOOLEAN DEFAULT FALSE,
    demo_mode BOOLEAN DEFAULT FALSE
);

INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    type TEXT DEFAULT '기타',
    group_name TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_attendees (
    event_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    name TEXT,
    attended_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (event_id, device_id)
);

CREATE TABLE IF NOT EXISTS pending_registrations (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    name TEXT,
    group_name TEXT DEFAULT '',
    subgroup TEXT DEFAULT '',
    requested_at TIMESTAMPTZ DEFAULT NOW()
);
