-- Backup completion email/AlimTalk delivery has been retired. Keep this migration
-- idempotent so environments that never applied the original feature migration also
-- converge safely.
ALTER TABLE config
  DROP COLUMN IF EXISTS backup_notifications,
  DROP COLUMN IF EXISTS backup_notify_token;
