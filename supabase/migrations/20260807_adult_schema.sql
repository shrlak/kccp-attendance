-- 장년부를 **자기 스키마**로 떼어낸다.
--
-- 지금까지 두 부서를 가르는 것은 쿼리에 걸린 조건(group_name)이었다. 그러면 조건을 한 군데만
-- 빠뜨려도 남의 명단이 새어 나간다. 여기서부터는 **표 자체가 다르다**: 장년부의 사람·기기·출석·
-- 권한·설정·감사기록은 전부 `adult` 스키마에 있고, `public`에는 대학·청년부만 남는다.
-- `public.members`를 아무 조건 없이 통째로 읽어도 장년부는 한 명도 나오지 않는다 — 거기에
-- 없기 때문이다. 백업도 이 경계를 그대로 따라간다 (pg_dump --schema=public / --schema=adult).
--
-- 표의 모양은 public에서 그대로 복제한다(`LIKE ... INCLUDING ALL`) — 컬럼·기본값·제약·인덱스가
-- 자동으로 따라오므로, 지금까지 쌓인 마이그레이션을 손으로 다시 옮겨 적다 어긋날 일이 없다.
-- 다만 두 가지는 LIKE가 가져오지 않아 직접 붙인다: 외래키, 그리고 시퀀스.
--
-- 시퀀스가 중요하다. bigserial의 기본값은 `nextval('public.…_id_seq')`라는 **식**이라서 LIKE로
-- 복제하면 두 스키마가 한 시퀀스를 나눠 쓰게 된다. 그러면 장년부만 담은 덤프가 public의 시퀀스를
-- 가리키게 되어 단독 복원이 깨진다. 그래서 adult 쪽 시퀀스를 새로 만들어 갈아 끼운다.
--
-- 공유로 남기는 것: login_log / ip_geo / gps_geo (부서가 아니라 시스템 전체의 접속 기록이고,
-- 지정된 한 사람만 읽는다), events / event_attendees / pending_registrations (예전 클라이언트
-- 잔재, 지금 앱은 쓰지 않는다). 카드 스캔 일일 한도는 두 스키마의 감사기록을 합쳐서 센다 —
-- 한도는 부서가 아니라 하나뿐인 API 키에 걸리는 것이므로 (엣지 함수 cardScanUsage).

CREATE SCHEMA IF NOT EXISTS adult;

COMMENT ON SCHEMA adult IS
  '장년부 전용. public은 대학·청년부. 두 부서는 표 단위로 갈라져 있어 서로를 조회할 수 없다.';

-- ── 표 ────────────────────────────────────────────────────────────────────────────────
-- public의 현재 모양을 그대로 복제한다. 이 파일보다 앞선 마이그레이션이 무엇을 더 붙였든
-- 자동으로 따라온다.
CREATE TABLE IF NOT EXISTS adult.members        (LIKE public.members        INCLUDING ALL);
CREATE TABLE IF NOT EXISTS adult.devices        (LIKE public.devices        INCLUDING ALL);
CREATE TABLE IF NOT EXISTS adult.attendance_log (LIKE public.attendance_log INCLUDING ALL);
CREATE TABLE IF NOT EXISTS adult.member_roles   (LIKE public.member_roles   INCLUDING ALL);
CREATE TABLE IF NOT EXISTS adult.config         (LIKE public.config         INCLUDING ALL);
CREATE TABLE IF NOT EXISTS adult.audit_log      (LIKE public.audit_log      INCLUDING ALL);

-- ── 시퀀스 (위 주석 참고: LIKE는 public 시퀀스를 가리키는 기본값을 복제해 온다) ─────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_log', 'audit_log'] LOOP
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS adult.%I_id_seq OWNED BY adult.%I.id', t, t);
    EXECUTE format('ALTER TABLE adult.%I ALTER COLUMN id SET DEFAULT nextval(''adult.%I_id_seq'')', t, t);
  END LOOP;
END $$;

-- ── 외래키 (LIKE가 가져오지 않는다). public이 아니라 adult.members를 가리켜야 한다. ────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adult_devices_member_fk') THEN
    ALTER TABLE adult.devices ADD CONSTRAINT adult_devices_member_fk
      FOREIGN KEY (member_id) REFERENCES adult.members(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adult_attlog_member_fk') THEN
    ALTER TABLE adult.attendance_log ADD CONSTRAINT adult_attlog_member_fk
      FOREIGN KEY (member_id) REFERENCES adult.members(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adult_member_roles_member_fk') THEN
    ALTER TABLE adult.member_roles ADD CONSTRAINT adult_member_roles_member_fk
      FOREIGN KEY (member_id) REFERENCES adult.members(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 설정은 부서마다 자기 행 하나(id=1). public.config의 `_adult` 접미사 칸들은 이 스키마가
-- 생기면서 필요 없어졌다 — 학기 일정·셀 이름·셀장·임원·부서 색·초기화 요청·백업 청구권 모두
-- 여기 자기 행에 평범한 이름으로 들어간다.
INSERT INTO adult.config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── RLS: public과 똑같이 전면 차단 ────────────────────────────────────────────────────
-- 정책을 하나도 두지 않으므로 anon/authenticated는 아무것도 읽지 못한다. 데이터로 가는 길은
-- 서비스 롤로 도는 엣지 함수 하나뿐이다.
ALTER TABLE adult.members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE adult.devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE adult.attendance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE adult.member_roles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE adult.config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE adult.audit_log      ENABLE ROW LEVEL SECURITY;

-- ── 권한 ──────────────────────────────────────────────────────────────────────────────
-- anon·authenticated·service_role은 **수파베이스가 만들어 주는 역할**이라 맨 포스트그레스에는
-- 없다. 주간 백업의 검증 단계가 바로 그 맨 포스트그레스다 — 일회용 컨테이너에 이 파일들을
-- 그대로 재생해서 "마이그레이션만으로 스키마가 선다"를 증명하는 자리인데, 없는 역할에
-- GRANT를 걸면 거기서 멈춘다 (그리고 그건 장년부만의 문제가 아니라 두 줄기 모두의 문제다).
-- 그래서 있는 역할에만 건다. 없는 곳에서는 줄 사람이 없으니 건너뛰는 것이 맞다.
DO $grants$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['postgres', 'anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA adult TO %I', role_name);
    END IF;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['postgres', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA adult TO %I', role_name);
      EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA adult TO %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA adult GRANT ALL ON TABLES TO %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA adult GRANT ALL ON SEQUENCES TO %I', role_name);
    END IF;
  END LOOP;
END $grants$;

-- ── 이미 public에 들어와 있는 장년부 사람들을 옮긴다 ──────────────────────────────────
-- 이 기능이 아직 운영에 없으므로 보통은 0건이다. 그래도 미리보기 브랜치나 시험 중에 들어간
-- 행이 남아 뒤섞이지 않도록, 부모 → 자식 순서로 옮기고 원본을 지운다.
DO $$
DECLARE moved int;
BEGIN
  CREATE TEMP TABLE _moving ON COMMIT DROP AS
    SELECT id FROM public.members WHERE COALESCE(group_name, '') = '장년부';
  SELECT count(*) INTO moved FROM _moving;
  IF moved = 0 THEN RETURN; END IF;

  INSERT INTO adult.members        SELECT * FROM public.members        WHERE id IN (SELECT id FROM _moving);
  INSERT INTO adult.devices        SELECT * FROM public.devices        WHERE member_id IN (SELECT id FROM _moving);
  INSERT INTO adult.attendance_log SELECT * FROM public.attendance_log WHERE member_id IN (SELECT id FROM _moving);
  INSERT INTO adult.member_roles   SELECT * FROM public.member_roles   WHERE member_id IN (SELECT id FROM _moving);

  -- 방문자 출석은 member_id가 없고 부서 표기로만 장년부다.
  INSERT INTO adult.attendance_log
    SELECT * FROM public.attendance_log
    WHERE member_id IS NULL AND COALESCE(group_name, '') = '장년부';

  DELETE FROM public.attendance_log
    WHERE member_id IN (SELECT id FROM _moving)
       OR (member_id IS NULL AND COALESCE(group_name, '') = '장년부');
  DELETE FROM public.member_roles WHERE member_id IN (SELECT id FROM _moving);
  DELETE FROM public.devices      WHERE member_id IN (SELECT id FROM _moving);
  DELETE FROM public.members      WHERE id IN (SELECT id FROM _moving);

  -- 옮겨 온 행의 id를 넘어서도록 시퀀스를 밀어 준다 (id를 그대로 들고 왔으므로).
  PERFORM setval('adult.attendance_log_id_seq',
                 GREATEST((SELECT COALESCE(MAX(id), 0) FROM adult.attendance_log), 1));
  RAISE NOTICE 'Moved % 장년부 member(s) into the adult schema', moved;
END $$;

-- ── PostgREST에 스키마를 노출한다 ─────────────────────────────────────────────────────
-- 엣지 함수는 supabase-js의 `.schema('adult')`로 이 표들을 읽는데, 그 경로는 PostgREST를
-- 지난다. 노출 목록에 없으면 전부 404가 난다. 현재 설정에 adult를 **덧붙이기만** 한다 —
-- 통째로 덮어쓰면 Supabase가 넣어 둔 graphql_public 같은 스키마가 사라진다.
DO $$
DECLARE current_schemas text;
BEGIN
  -- authenticator 역시 수파베이스가 만들어 주는 역할이라 맨 포스트그레스에는 없다.
  -- 없는 곳에서는 PostgREST도 없으니 노출할 스키마 목록이라는 것 자체가 없다 — 건너뛴다.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    RETURN;
  END IF;

  SELECT COALESCE(
           (SELECT split_part(s, '=', 2)
              FROM unnest(setconfig) AS s
             WHERE s LIKE 'pgrst.db_schemas=%'
             LIMIT 1),
           'public, graphql_public')
    INTO current_schemas
    FROM pg_db_role_setting
    JOIN pg_roles ON pg_roles.oid = pg_db_role_setting.setrole
   WHERE pg_roles.rolname = 'authenticator'
   LIMIT 1;

  IF current_schemas IS NULL THEN
    current_schemas := 'public, graphql_public';
  END IF;

  IF current_schemas !~ '(^|,)\s*adult\s*($|,)' THEN
    EXECUTE format('ALTER ROLE authenticator SET pgrst.db_schemas = %L', current_schemas || ', adult');
  END IF;
END $$;

NOTIFY pgrst, 'reload config';
