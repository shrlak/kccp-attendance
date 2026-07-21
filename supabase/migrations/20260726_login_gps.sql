-- Precise (device-GPS) location for admin sign-ins. When an admin allows the browser's
-- location prompt at login, /api/admin/verify receives the coordinates and stores them on
-- the login_log row; the login-history viewer (김호연) then sees a street-level address
-- instead of the city-level IP estimate. Denied/unsupported → columns stay NULL and the
-- viewer falls back to the ip_geo city guess (see 20260725_ip_geo_cache.sql).
--
-- gps_accuracy is the browser's own radius estimate in meters (Geolocation API accuracy).
ALTER TABLE login_log ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION;
ALTER TABLE login_log ADD COLUMN IF NOT EXISTS gps_lon DOUBLE PRECISION;
ALTER TABLE login_log ADD COLUMN IF NOT EXISTS gps_accuracy DOUBLE PRECISION;

-- Reverse-geocode cache: coordinate → human-readable address, so a repeated login from the
-- same place isn't re-resolved against the external geocoder on every login-log read. Keyed
-- by the coordinates rounded to 5 decimals (~1 m) as "lat,lon". Mirrors ip_geo's pattern.
CREATE TABLE IF NOT EXISTS gps_geo (
    coord_key TEXT PRIMARY KEY,
    address TEXT DEFAULT '',
    resolved_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deny-all backstop, same as every other table (see 20260618_rls.sql): no policies on
-- purpose — the service-role edge function is the only reader/writer.
ALTER TABLE gps_geo ENABLE ROW LEVEL SECURITY;
