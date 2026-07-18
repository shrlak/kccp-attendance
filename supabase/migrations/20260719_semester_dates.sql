-- Configurable recurring semester boundaries for 관리자 › 설정. Values omit the year so
-- the same spring/summer/fall month-day schedule projects into each calendar year.
-- NULL preserves the legacy client boundaries until a super-admin explicitly saves them.
ALTER TABLE config
  ADD COLUMN IF NOT EXISTS semester_dates jsonb DEFAULT NULL;

COMMENT ON COLUMN config.semester_dates IS
  'Recurring term ranges: {spring|summer|fall:{start:MM-DD,end:MM-DD}}';
