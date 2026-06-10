-- Promote the shared 임원 leader account (20260621) to a 합동 scope spanning BOTH
-- 대학부 and 청년부 in EVERY season — not just summer mode.
--
-- scopeFilter() in auth.ts now treats a leader whose group is "합동" as both 부서
-- regardless of config.summer_mode ("합동" is the codebase's existing word for the
-- combined 대학·청년부). Storing "합동" here makes the 임원s' visibility season-independent.
--
-- ⚠️ DEPLOY ORDERING — apply this ONLY after the edge function that understands "합동"
-- is live (it deploys on merge to main; see .github/workflows/deploy.yml). The previous
-- function (v14) maps any non-대학부/청년부 group to itself, so setting "합동" before the
-- new function is deployed would scope the 임원 roster to an empty group. Until then the
-- account stays group="대학부", which already spans both 부서 while summer mode is on. So
-- in prod this is applied post-deploy via apply_migration; the file is committed here for
-- fresh-replay parity (where the new function is already present).
--
-- Idempotent + guarded for branching drift.
DO $$
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

  UPDATE member_roles r
    SET group_name='합동', subgroup=''
    FROM members m
    WHERE m.id=r.member_id
      AND lower(m.email)=lower('kccp.bitjulove@gmail.com')
      AND r.role='leader';
END $$;
