-- Backup completion notifications: the recipient lists managed in-app (Admins tab →
-- 전체 백업 → 백업 완료 알림) and a machine token the weekly backup workflow presents to
-- the edge function's /api/admin/db-backup/notify endpoint after the new current.* set
-- is verified in R2.
--
-- backup_notify_token is not a human secret: scripts/backup/notify.sh reads it over the
-- workflow's existing read-only backup_reader connection (its table-level SELECT on
-- config covers new columns automatically), so notifications need no extra GitHub
-- secret. Idempotent + guarded for preview-branch replays.
ALTER TABLE config ADD COLUMN IF NOT EXISTS backup_notifications jsonb NOT NULL
  DEFAULT '{"enabled": true, "emails": [], "phones": []}'::jsonb;
ALTER TABLE config ADD COLUMN IF NOT EXISTS backup_notify_token text NOT NULL
  DEFAULT replace(gen_random_uuid()::text, '-', '');
