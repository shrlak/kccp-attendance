-- 멤버당 상태 표기를 여러 개 달 수 있게: [{note, start, end}] 목록.
-- 기존 단일 컬럼(status_note/status_start/status_end)은 그대로 두고 목록의 "현재/최신"
-- 표기를 서버가 계속 mirror 한다 — 백업·예전 클라이언트가 읽던 값이라서.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS status_marks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN members.status_marks IS
  'Status marks [{note,start,end}]; status_note/start/end mirror the current or latest one';

-- 이미 달려 있던 표기를 한 칸짜리 목록으로 옮긴다 (한 번만, 목록이 비어 있는 행에 한해).
UPDATE members
SET status_marks = jsonb_build_array(
      jsonb_build_object(
        'note', status_note,
        'start', to_jsonb(status_start),
        'end', to_jsonb(status_end)))
WHERE coalesce(status_note, '') <> ''
  AND coalesce(jsonb_array_length(status_marks), 0) = 0;
