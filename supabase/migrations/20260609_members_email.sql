-- Add email column to members for Google OAuth admin login.
-- case-insensitive unique index so lookups are fast and duplicate emails are rejected.
ALTER TABLE members ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique ON members (lower(email)) WHERE email IS NOT NULL;
