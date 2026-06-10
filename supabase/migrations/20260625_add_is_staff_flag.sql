-- Mark certain members as "staff accounts" (임원, 새가족팀장, 멘토, 목사님, …) so the
-- admin UI can exclude them from the regular member count and show them in a separate
-- section. is_staff has nothing to do with admin roles in member_roles — it is purely a
-- display/count flag on the member record itself. Set it here for the two shared role
-- accounts created in 20260621/20260622; all other members default to false.
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_staff boolean DEFAULT false;

UPDATE members SET is_staff = true
WHERE lower(email) IN (
  lower('kccp.bitjulove@gmail.com'),   -- 임원
  lower('kccpwelcome23@gmail.com')     -- 새가족팀장
);
