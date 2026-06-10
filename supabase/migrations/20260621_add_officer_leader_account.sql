-- Shared 임원 (officers) admin account for the 대학·청년부.
--
-- The 임원s log into the admin panel via Google OAuth with kccp.bitjulove@gmail.com
-- (email → members.email → member_roles, per auth.ts verifyAdminJwt).
--
-- IDENTITY vs SCOPE — two different columns in two different tables:
--   • The MEMBER is deliberately group-less (group_name='') and 동산-less (subgroup=''),
--     so this role account never shows up as a real person in any roster or 동산 view.
--   • The LEADER SCOPE (member_roles) is pinned to 대학부 with no 동산. In summer mode
--     (합동, currently ON) scopeFilter expands 대학부 → 대학부+청년부, and an empty
--     subgroup imposes no 동산 restriction → the officers see/manage the entire
--     대학·청년부 across every 동산. ministry='KM' matches the other KM leader rows.
--
-- Idempotent + guarded so it's safe to re-run and no-ops on preview branches that
-- lack the base schema or the email column (branching drift — see 20260609_members_email).
DO $$
DECLARE
  v_member_id uuid;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname='public' AND tablename='members') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema='public' AND table_name='members' AND column_name='email'
  ) THEN
    RETURN;
  END IF;

  -- Upsert the member by email (case-insensitive members_email_unique index).
  SELECT id INTO v_member_id FROM members WHERE lower(email)=lower('kccp.bitjulove@gmail.com');
  IF v_member_id IS NULL THEN
    INSERT INTO members (name, group_name, subgroup, email)
    VALUES ('임원', '', '', 'kccp.bitjulove@gmail.com')
    RETURNING id INTO v_member_id;
  ELSE
    UPDATE members
      SET name='임원', group_name='', subgroup='', updated_at=now()
      WHERE id=v_member_id;
  END IF;

  -- Grant the leader role scoped to 대학부 (summer 합동 → 대학부+청년부, all 동산).
  INSERT INTO member_roles (member_id, role, group_name, subgroup, ministry)
  VALUES (v_member_id, 'leader', '대학부', '', 'KM')
  ON CONFLICT (member_id) DO UPDATE
    SET role=EXCLUDED.role, group_name=EXCLUDED.group_name,
        subgroup=EXCLUDED.subgroup, ministry=EXCLUDED.ministry;
END $$;
