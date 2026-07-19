-- Card-photo recognition is governed by a daily Gemini-call allowance. Preserve the
-- administrator's existing numeric allowance when moving away from the original monthly
-- counter, and leave the old column in place for rollback compatibility.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'config'
          AND column_name = 'card_scan_daily_limit'
    ) THEN
        ALTER TABLE config
            ADD COLUMN card_scan_daily_limit integer NOT NULL DEFAULT 60;

        UPDATE config
        SET card_scan_daily_limit = card_scan_monthly_limit;
    END IF;
END
$$;

-- The live remaining-attempt counter filters audit entries by action and timestamp.
CREATE INDEX IF NOT EXISTS audit_log_action_ts_idx ON audit_log (action, ts DESC);
