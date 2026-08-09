-- 장년부(Adult Ministry)를 같은 시스템 위에서, 대학·청년부와 완전히 갈라서 돌리기 위한 칸들.
--
-- 데이터는 표를 새로 만들지 않는다: 사람과 출석은 지금까지처럼 members / devices /
-- attendance_log에 들어가고, 어느 부(部)의 것인지는 부서(group_name = '장년부')로 갈린다.
-- 갈라야 하는 것은 **설정**이다 — 학기 일정, 동산 이름, 동산지기, 임원, 부서 색, 대기 중인
-- 출석 초기화 요청, 자동 백업 청구권까지. 한 config 행을 공유하면 한쪽에서 저장할 때마다
-- 다른 쪽이 덮여 버리므로, 장년부 몫은 `_adult` 접미사가 붙은 자기 칸에 넣는다.
-- (엣지 함수 index.ts의 ck()/cfgVal()이 이 규칙을 강제한다.)
--
-- 값을 미리 채워 두지 않는다: 비어 있으면 엣지 함수가 그 부서의 기본값(동산 이름 1~4구역,
-- 초록 계열 부서 색, 기본 학기 템플릿)을 쓰고, 장년부 설정 탭에서 처음 저장하는 순간 채워진다.
-- 대학·청년부 쪽 컬럼은 손대지 않으므로 이 마이그레이션은 기존 동작을 바꾸지 않는다.

ALTER TABLE config
  ADD COLUMN IF NOT EXISTS semester_dates_adult            jsonb,
  ADD COLUMN IF NOT EXISTS semester_schedule_adult         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dongsan_names_adult             jsonb,
  ADD COLUMN IF NOT EXISTS new_member_dongsan_names_adult  jsonb,
  ADD COLUMN IF NOT EXISTS dongsan_leaders_adult           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dongsan_history_adult           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dongsan_reset_term_adult        text,
  ADD COLUMN IF NOT EXISTS officers_adult                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS group_colors_adult              jsonb,
  ADD COLUMN IF NOT EXISTS pending_clear_adult             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_auto_backup_at_adult       timestamptz;

COMMENT ON COLUMN config.semester_schedule_adult IS
  '장년부 학기 일정 (대학·청년부 semester_schedule의 짝) — 두 부서는 각자 일정을 쓴다';
COMMENT ON COLUMN config.dongsan_reset_term_adult IS
  '장년부 학기 종료 롤오버를 한 학기에 한 번만 돌리기 위한 표식';
COMMENT ON COLUMN config.last_auto_backup_at_adult IS
  '장년부 자동 백업 청구권 — 장년부에서 일어난 변경만 장년부 백업 줄기를 깨운다';

-- 감사 로그도 부서별로 갈린다. 장년부 관리자 탭은 장년부에서 일어난 일만 본다.
-- 예전 행은 'youth'로 채운다 — 그때는 대학·청년부밖에 없었으므로 사실 그대로다.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS partition text NOT NULL DEFAULT 'youth';

COMMENT ON COLUMN audit_log.partition IS
  'Which 부 this action happened in: youth (대학·청년부) or adult (장년부)';

-- 관리자 탭은 최근 순으로 자기 부의 행만 읽는다.
CREATE INDEX IF NOT EXISTS idx_audit_partition_ts ON audit_log(partition, ts DESC);

-- 출석부·오늘 명단은 부서로 걸러 읽는다 (부 분리의 핫패스).
CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_name);
CREATE INDEX IF NOT EXISTS idx_attlog_group_date ON attendance_log(group_name, date);
