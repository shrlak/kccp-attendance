-- Add extended member profile fields to devices table
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS baptism_status TEXT DEFAULT '해당없음',
  ADD COLUMN IF NOT EXISTS school_or_work TEXT,
  ADD COLUMN IF NOT EXISTS faith_duration TEXT,
  ADD COLUMN IF NOT EXISTS registration_date DATE,
  ADD COLUMN IF NOT EXISTS pastoral_visit_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_new_member BOOLEAN DEFAULT TRUE;

-- Add individual check-in toggle (false = kiosk-only mode)
ALTER TABLE config
  ADD COLUMN IF NOT EXISTS individual_checkin_enabled BOOLEAN DEFAULT FALSE;
