-- 방태준 목사님 — pastor account with SUPER ADMIN access, marked as a 운영계정 (staff).
--
-- Logs into the admin panel via Google OAuth with kccp.pastor.tj@gmail.com
-- (email → members.email → member_roles, per auth.ts verifyAdminJwt). Like the shared
-- 임원 / 새가족팀장 role accounts (20260621/20260622) he is group-less (group_name='') and
-- 동산-less (subgroup='') so he never appears in a roster or 동산 view, and is_staff=true
-- lists him under the 운영 계정 section (excluded from member counts / analytics, #95).
--
-- His pastoral title is recorded on the member row (name '방태준 목사님', member_role
-- 'pastor'), while ADMIN ACCESS is granted via member_roles.role='super_admin' — full
-- access. (The 'pastor' admin role is read-only; member_roles has one role per member
-- via PK on member_id, so super_admin is the single access role.)
--
-- Idempotent + guarded for branching drift (see 20260609_members_email / 20260621).
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
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema='public' AND table_name='members' AND column_name='is_staff'
  ) THEN
    RETURN;
  END IF;

  -- Upsert the member by email (case-insensitive members_email_unique index).
  SELECT id INTO v_member_id FROM members WHERE lower(email)=lower('kccp.pastor.tj@gmail.com');
  IF v_member_id IS NULL THEN
    INSERT INTO members (name, group_name, subgroup, email, member_role, is_staff)
    VALUES ('방태준 목사님', '', '', 'kccp.pastor.tj@gmail.com', 'pastor', true)
    RETURNING id INTO v_member_id;
  ELSE
    UPDATE members
      SET name='방태준 목사님', group_name='', subgroup='',
          member_role='pastor', is_staff=true, updated_at=now()
      WHERE id=v_member_id;
  END IF;

  -- Grant SUPER ADMIN access (scope {all:true}; group/subgroup/ministry irrelevant).
  INSERT INTO member_roles (member_id, role, group_name, subgroup, ministry)
  VALUES (v_member_id, 'super_admin', '', '', '')
  ON CONFLICT (member_id) DO UPDATE
    SET role=EXCLUDED.role, group_name=EXCLUDED.group_name,
        subgroup=EXCLUDED.subgroup, ministry=EXCLUDED.ministry;
END $$;
