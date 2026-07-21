-- IP → approximate place cache for the login log (/api/admin/login-log). Each distinct
-- sign-in IP is resolved once via ipwho.is (city-level — an IP can never give a GPS-exact
-- position) and remembered here so the log renders locations without re-querying the
-- external API. A row with empty fields is a deliberate negative cache (private/reserved
-- IP) so it isn't retried forever.

CREATE TABLE IF NOT EXISTS ip_geo (
    ip TEXT PRIMARY KEY,
    city TEXT DEFAULT '',
    region TEXT DEFAULT '',
    country TEXT DEFAULT '',
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    org TEXT DEFAULT '',
    resolved_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deny-all backstop, same as every other table (see 20260618_rls.sql): no policies on
-- purpose — the service-role edge function is the only reader/writer.
ALTER TABLE ip_geo ENABLE ROW LEVEL SECURITY;
