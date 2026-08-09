-- 장년부 백업이 담을 범위로 임시(검증용) 데이터베이스를 깎아낸다.
--
-- run-backup.sh가 PARTITION=adult 로 돌 때만 실행된다. 흐름은 이렇다: 운영 DB에서 전체를
-- 덤프해 일회용 검증 DB에 그대로 올린 뒤, **거기서** 장년부가 아닌 것을 지우고 다시 덤프한다.
-- 그 결과물이 backups/adult/ 에 올라가는 파일이다. 운영 DB는 읽기 전용으로만 만지므로 이
-- 스크립트가 운영 데이터를 건드릴 일은 없다 (연결 문자열이 검증 DB를 가리킨다).
--
-- 남기는 표는 엣지 함수 index.ts의 ADULT_PARTITION_TABLES와 정확히 같아야 한다 — 복원이
-- 되돌리는 범위가 그 목록이기 때문이다. 그 밖의 표는 전부 비운다:
--   • config          두 부서가 한 행을 나눠 쓴다. 장년부 몫만 떼어 복원할 방법이 없고, 설정은
--                     대학·청년부(backups/)의 전체 스냅숏이 이미 담고 있다.
--   • audit_log       부서별로 갈리기는 하나 감사 기록이지 명단이 아니다.
--   • login_log·*_geo 로그인 기록은 부서에 속하지 않는다.
--   • events·pending  두 부서가 함께 쓰거나 이 부서가 쓰지 않는다.
--
-- 즉 장년부 줄기는 **장년부 사람들의 명단과 출석**을 담는다. 데이터베이스 전체의 재해복구선은
-- 여전히 대학·청년부 줄기(backups/, 전체 덤프)가 지킨다.

\set ON_ERROR_STOP on

BEGIN;

-- 자식 → 부모 순서로. attendance_log.member_id는 ON DELETE SET NULL이라 멤버를 먼저 지우면
-- 출석 행이 부서 표기만 남고 떠돌게 되므로, 반드시 출석부터 지운다.
CREATE TEMP TABLE adult_members AS
  SELECT id FROM public.members WHERE COALESCE(group_name, '') = '장년부';

DELETE FROM public.attendance_log
  WHERE COALESCE(group_name, '') <> '장년부'
    AND (member_id IS NULL OR member_id NOT IN (SELECT id FROM adult_members));

DELETE FROM public.member_roles
  WHERE member_id NOT IN (SELECT id FROM adult_members);

DELETE FROM public.devices
  WHERE COALESCE(group_name, '') <> '장년부'
    AND (member_id IS NULL OR member_id NOT IN (SELECT id FROM adult_members));

DELETE FROM public.members
  WHERE id NOT IN (SELECT id FROM adult_members);

-- 장년부 범위 밖의 표는 통째로 비운다 (위 주석 참고).
TRUNCATE TABLE
  public.config,
  public.audit_log,
  public.events,
  public.event_attendees,
  public.pending_registrations
  RESTART IDENTITY CASCADE;

-- 이 배포에 아직 없을 수도 있는 표들 — 있으면 비우고, 없으면 넘어간다.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['login_log', 'ip_geo', 'gps_geo'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;
END $$;

DROP TABLE adult_members;

COMMIT;
