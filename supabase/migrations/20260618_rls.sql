-- Row-Level Security — pure DENY-ALL backstop (spec D1, device+master-password model).
--
-- ⚠️ APPLY ONLY DURING THE COORDINATED CUTOVER (plan Phase F). Enabling RLS while the
-- legacy app is still live breaks it: the legacy client reads the roster via the
-- (unauthenticated) edge function, and the world-readable `/api/data` path depends on
-- no row filtering. RLS + the hardened function + the React deploy flip together.
--
-- Because admin auth is device-id + master password verified INSIDE the edge function
-- (service-role), NO user JWTs ever reach PostgREST. Enabling RLS with NO policies
-- therefore denies all anon/authenticated access to every table, while service_role
-- (the function) bypasses RLS and stays the sole data path. That alone closes the
-- world-readable `/api/data` PII hole — no auth.uid()-based policies are needed.

ALTER TABLE members               ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE config                ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles          ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: anon/authenticated get nothing; the edge function
-- (service_role) performs all reads/writes and enforces device + master-password +
-- role scoping in TypeScript (see auth.ts).
