-- Admin sign-in log (super-admin only via /api/admin/login-log): one row per successful
-- /api/admin/verify — who (role + linked member name when the device maps to one), when
-- (epoch-ms ts, matching audit_log), and from where (client IP + device id + user agent).
-- member_id is intentionally not FK'd to members (mirrors audit_log): a login record must
-- survive the member being merged/deleted.

CREATE TABLE IF NOT EXISTS login_log (
    id BIGSERIAL PRIMARY KEY,
    ts BIGINT NOT NULL,
    role TEXT NOT NULL,
    member_id UUID,
    member_name TEXT DEFAULT '',
    device_id TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    method TEXT DEFAULT 'password',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_log_ts_idx ON login_log (ts DESC);

-- Deny-all backstop, same as every other table (see 20260618_rls.sql): no policies on
-- purpose — the service-role edge function is the only reader/writer.
ALTER TABLE login_log ENABLE ROW LEVEL SECURITY;
