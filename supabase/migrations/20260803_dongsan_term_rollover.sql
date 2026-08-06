-- 학기 종료 롤오버: 학기가 끝나면 동산 편성을 비운다 (attendance-api의 rolloverDongsan).
--
-- dongsan_reset_term  마지막으로 처리한 "끝난 학기"의 키 ("2026-summer"). 같은 학기를 두 번
--                     초기화하지 않게 하는 표식이다. NULL(이 마이그레이션 직후)일 때는 초기화
--                     없이 현재 값을 기록만 한다 — 배포 시점에 이미 끝나 있던 학기 때문에
--                     학기 도중 동산이 지워지는 일이 없도록.
-- dongsan_history     초기화 전에 얼려둔 학기별 동산 편성
--                     {"2026-summer": {endedAt, subgroups:{member_id:동산}, names, leaders}}.
--                     지난 학기 출석부(아카이브)가 그 학기의 동산 블록을 그대로 유지하는 근거.
ALTER TABLE config
  ADD COLUMN IF NOT EXISTS dongsan_reset_term text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dongsan_history jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN config.dongsan_reset_term IS
  'Term key ("2026-summer") whose 동산 rollover already ran; NULL seeds without wiping';
COMMENT ON COLUMN config.dongsan_history IS
  'Retired 동산 편성 per term: {term_key: {endedAt, subgroups, names, leaders}}';

-- 여름 모드는 더 이상 토글이 아니다. 저장된 여름학기 일정 안에 오늘이 들어있으면 켜진 것으로
-- 계산한다 (attendance-api term.ts isSummerTerm). 이 컬럼은 예전 값이 남아있을 뿐 읽지 않는다.
COMMENT ON COLUMN config.summer_mode IS
  'DEPRECATED — derived from semester_dates (여름학기 기간이면 on); no longer read or written';
