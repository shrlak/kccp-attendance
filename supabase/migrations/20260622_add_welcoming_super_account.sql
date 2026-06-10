-- Shared 새가족팀장 (welcoming-team lead) admin account — a SUPER ADMIN.
--
-- Logs into the admin panel via Google OAuth with kccpwelcome23@gmail.com
-- (email → members.email → member_roles, per auth.ts verifyAdminJwt). Like the 임원
-- account (20260621) this is a ROLE account, not a real person: group-less
-- (group_name='') and 동산-less (subgroup='') so it never shows up in any roster or
-- 동산 view. super_admin scope is {all:true}, so the role's group/subgroup/ministry
-- are irrelevant (left '').
--
-- Idempotent + guarded so it no-ops on preview branches lacking the base schema / email
-- column (branching drift — see 20260609_members_email / 20260621).
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

  SELECT id INTO v_member_id FROM members WHERE lower(email)=lower('kccpwelcome23@gmail.com');
  IF v_member_id IS NULL THEN
    INSERT INTO members (name, group_name, subgroup, email)
    VALUES ('새가족팀장', '', '', 'kccpwelcome23@gmail.com')
    RETURNING id INTO v_member_id;
  ELSE
    UPDATE members
      SET name='새가족팀장', group_name='', subgroup='', updated_at=now()
      WHERE id=v_member_id;
  END IF;

  INSERT INTO member_roles (member_id, role, group_name, subgroup, ministry)
  VALUES (v_member_id, 'super_admin', '', '', '')
  ON CONFLICT (member_id) DO UPDATE
    SET role=EXCLUDED.role, group_name=EXCLUDED.group_name,
        subgroup=EXCLUDED.subgroup, ministry=EXCLUDED.ministry;
END $$;
