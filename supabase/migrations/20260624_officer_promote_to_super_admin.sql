-- Promote the shared 임원 account (20260621) from leader to super_admin.
-- super_admin scope is {all:true} so group/subgroup/ministry are cleared.
-- Idempotent + guarded for branching drift.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname='public' AND tablename='member_roles') THEN
    RETURN;
  END IF;
  UPDATE member_roles r
    SET role='super_admin', group_name='', subgroup='', ministry=''
    FROM members m
    WHERE m.id = r.member_id
      AND lower(m.email) = lower('kccp.bitjulove@gmail.com');
END $$;
