-- Auto-backup on data change: the edge function claims the right to dispatch the
-- off-site backup workflow at most once per cooldown window via a compare-and-set
-- UPDATE on this timestamp, so concurrent isolates can't double-dispatch.
alter table config add column if not exists last_auto_backup_at timestamptz;
