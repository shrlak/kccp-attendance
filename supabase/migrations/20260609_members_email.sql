-- Add email column to members for Google OAuth admin login.
-- case-insensitive unique index so lookups are fast and duplicate emails are rejected.
-- Guarded: no-ops on preview branches that lack the base schema (branching drift).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'members') THEN
    RETURN;
  END IF;
  ALTER TABLE members ADD COLUMN IF NOT EXISTS email text;
  IF NOT EXISTS (SELECT FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'members_email_unique') THEN
    EXECUTE 'CREATE UNIQUE INDEX members_email_unique ON members (lower(email)) WHERE email IS NOT NULL';
  END IF;
END $$;
