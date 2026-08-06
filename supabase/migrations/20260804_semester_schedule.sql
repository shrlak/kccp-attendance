-- 2년치 학기 일정: 설정에서 학기별로 실제 날짜를 정해 저장한다.
--
-- semester_schedule  [{year, season, start, end}] — 실제 날짜(YYYY-MM-DD)를 가진 학기 목록.
--                    설정 탭은 이 중 아직 끝나지 않은 6개(2년치)를 보여주고, 학기가 끝나면
--                    목록에서 빠지는 대신 맨 뒤에 다음 학기가 자동으로 추가된다(rollSchedule).
--                    끝난 학기도 지난 학기 출석부를 위해 배열에 남아 있다(최근 12개).
--                    비어 있으면 semester_dates(매년 반복되는 월·일 템플릿)로 계산한다.
ALTER TABLE config
  ADD COLUMN IF NOT EXISTS semester_schedule jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN config.semester_schedule IS
  'Rolling term list [{year,season,start,end}] with real dates; semester_dates is the recurring fallback';
