-- Create config table for fresh databases (preview branches)
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    admin_password TEXT,
    admin_devices JSONB DEFAULT '[]',
    name_order JSONB DEFAULT '[]',
    dongsan_names JSONB,
    dongsan_leaders JSONB DEFAULT '{}',
    checkin_days INTEGER[] DEFAULT '{0}',
    checkin_start_min INTEGER DEFAULT 780,
    checkin_end_min INTEGER DEFAULT 900,
    require_approval BOOLEAN DEFAULT FALSE,
    announcement TEXT DEFAULT '',
    summer_mode BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure a default config row exists
INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Add summer_mode to existing databases that already have the config table
ALTER TABLE config ADD COLUMN IF NOT EXISTS summer_mode BOOLEAN DEFAULT FALSE;
