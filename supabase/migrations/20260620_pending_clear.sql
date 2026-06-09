-- Pending "clear all attendance" requests from non-super admins, awaiting a super-admin's
-- approval (plan: destructive clears by non-supers are held, not applied immediately).
-- Each entry: { requestedBy, requestedByName, requestedAt }. Super-admins clear directly.
-- Additive (nullable JSONB with default) — safe to apply any time.
ALTER TABLE config ADD COLUMN IF NOT EXISTS pending_clear jsonb DEFAULT '[]'::jsonb;
