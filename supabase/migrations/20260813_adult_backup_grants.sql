-- 백업 역할에게 adult 스키마를 열어 준다.
--
-- 주간 백업이 장년부 줄기에서 이렇게 죽고 있었다:
--   pg_dump: error: query failed: ERROR: permission denied for schema adult
--   detail: LOCK TABLE adult.members, … IN ACCESS SHARE MODE
--
-- 20260807이 adult 스키마를 만들 때 엣지 함수가 쓰는 역할(service_role·authenticator)만
-- 챙기고 **백업 역할 둘을 빠뜨렸다.** 그래서 장년부 백업은 만들어진 뒤로 한 번도 성공한
-- 적이 없다 — 대학·청년부(public) 줄기만 돌고 있었다. 재해복구에 두 파일이 다 필요하다고
-- 적어 둔 그 두 번째 파일이 실제로는 없었던 셈이다.
--
-- public에 걸려 있는 것과 **똑같은 모양**으로 맞춘다:
--   backup_reader    SELECT (표) + SELECT (시퀀스)   — pg_dump가 읽는 데 필요한 만큼만
--   backup_restorer  SELECT · INSERT · TRUNCATE      — 복원이 TRUNCATE 후 흘려 넣으므로
--
-- 앞으로 adult에 표가 하나 더 생겨도 다시 빠뜨리지 않도록 기본 권한(ALTER DEFAULT
-- PRIVILEGES)도 함께 건다. 20260807이 이 줄들을 갖고 있었다면 애초에 죽지 않았을 것이다.
--
-- 역할이 없는 데이터베이스에서도 이 마이그레이션은 통과해야 한다: PR 미리보기 브랜치는
-- 빈 프로젝트에서 전체를 재생하는데, 거기에는 backup_reader/backup_restorer가 없다.
-- 없으면 조용히 건너뛴다 — 그 브랜치에는 백업도 없으므로 열어 줄 이유가 없다.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_reader') THEN
    GRANT USAGE ON SCHEMA adult TO backup_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA adult TO backup_reader;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA adult TO backup_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA adult GRANT SELECT ON TABLES TO backup_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA adult GRANT SELECT ON SEQUENCES TO backup_reader;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_restorer') THEN
    GRANT USAGE ON SCHEMA adult TO backup_restorer;
    GRANT SELECT, INSERT, TRUNCATE ON ALL TABLES IN SCHEMA adult TO backup_restorer;
    -- 복원은 TRUNCATE … RESTART IDENTITY로 시퀀스를 되돌리므로 시퀀스도 만질 수 있어야 한다.
    GRANT SELECT, USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA adult TO backup_restorer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA adult GRANT SELECT, INSERT, TRUNCATE ON TABLES TO backup_restorer;
    ALTER DEFAULT PRIVILEGES IN SCHEMA adult GRANT SELECT, USAGE, UPDATE ON SEQUENCES TO backup_restorer;
  END IF;
END $$;
