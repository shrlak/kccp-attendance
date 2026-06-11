-- 방태준 목사님 — admin access changed from SUPER ADMIN to PASTOR (read-only).
--
-- 20260626 granted member_roles.role='super_admin'; per 임원 요청 his access is now the
-- read-only 'pastor' admin role (full visibility across all groups, no edits — see
-- auth.ts scopeFilter: pastor → {all:true}, and the pastor write-guards in index.ts).
-- His member row is unchanged (name '방태준 목사님', member_role='pastor', is_staff=true,
-- group-less so he never appears in rosters).
--
-- Upserts (rather than updates) so the role exists even if the super_admin grant was
-- removed out-of-band. Idempotent + guarded for branching replay (see 20260626).
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

  SELECT id INTO v_member_id FROM members WHERE lower(email)=lower('kccp.pastor.tj@gmail.com');
  IF v_member_id IS NULL THEN
    RETURN; -- member seeded by 20260626; nothing to do on branches where it was skipped
  END IF;

  INSERT INTO member_roles (member_id, role, group_name, subgroup, ministry)
  VALUES (v_member_id, 'pastor', '', '', '')
  ON CONFLICT (member_id) DO UPDATE
    SET role='pastor', group_name='', subgroup='', ministry='';
END $$;
