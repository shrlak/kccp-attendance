-- 관리자가 앱에서 고치거나 지운 **시트 표기**를 기억하는 칸.
--
-- 시트 연동(sheetSync.ts)은 자기가 적은 상태 표기(source:'sheet')만 갈아 끼우고 사람이 적은
-- 것은 건드리지 않는다. 그런데 멤버 편집 창은 {note,start,end}만 알고 source를 모르므로,
-- 저장하는 순간 시트 표기가 '사람이 적은 표기'로 바뀌었고 다음 동기화는 제 것이 없어졌다고
-- 보고 시트 것을 또 얹었다. 그래서
--   · 아무 칸이나 고쳐 저장할 때마다 같은 표기가 하나씩 늘었고 (최휘서의 '출장'이 셋씩),
--   · 시트가 끝까지 닫지 않은 구간(= 기한 없음 = 명단에서 숨김)에 관리자가 끝나는 날을 적어
--     풀어 주어도 10분 뒤 기한 없는 시트 표기가 다시 붙어 그 사람이 또 숨겨졌다 (이래현 —
--     여름 동산 시트의 '한국'이 시트 끝까지 이어져 있다).
-- 이제 서버가 편집을 저장할 때 그대로 지나간 시트 표기에는 출처를 되붙이고, 고쳐지거나
-- 지워진 시트 표기는 여기에 {note,start}로 남긴다 — 동기화는 이 열쇠의 구간을 다시 쓰지 않는다.
--
-- 두 스키마에 똑같이 붙인다 (20260807이 LIKE로 만든 두 members 표의 복제 관계를 유지).

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS sheet_mark_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE adult.members  ADD COLUMN IF NOT EXISTS sheet_mark_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.members.sheet_mark_overrides IS
  '관리자가 앱에서 고치거나 지운 시트 표기 [{note,start}] — 시트 연동이 이 구간을 다시 쓰지 않는다';
COMMENT ON COLUMN adult.members.sheet_mark_overrides IS
  '관리자가 앱에서 고치거나 지운 시트 표기 [{note,start}] — 시트 연동이 이 구간을 다시 쓰지 않는다';

-- 지금까지 쌓인 것을 정리한다. 시트 표기 S 하나마다:
--   1. 사람이 적은 표기 중 S와 **똑같은** 것이 있으면 — 편집 창을 그대로 지나가며 출처를 잃은
--      복사본이다. 복사본을 지우고 S를 남긴다.
--   2. 아니고 **시작일이 같은** 사람의 표기가 있으면 — 관리자가 S를 고친 것이다 (끝나는 날을
--      적었거나 말을 바꿨다). 관리자 것을 남기고 S를 지우고, S의 열쇠를 남겨 다시 오지 않게 한다.
--   3. 그 밖에는 그대로 둔다.
-- 다시 돌려도 같은 결과다 (1·2를 거친 줄에는 걸릴 것이 남지 않는다).
DO $$
DECLARE
  sch text;
  r record;
  mark jsonb;
  manual jsonb;
  sheet_kept jsonb;
  ov jsonb;
  key jsonb;
BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'adult'] LOOP
    FOR r IN EXECUTE format(
      $q$SELECT id, status_marks, sheet_mark_overrides FROM %I.members
         WHERE jsonb_typeof(status_marks) = 'array' AND status_marks @> '[{"source":"sheet"}]'::jsonb$q$, sch)
    LOOP
      manual := coalesce((
        SELECT jsonb_agg(e ORDER BY o) FROM jsonb_array_elements(r.status_marks) WITH ORDINALITY t(e, o)
        WHERE e->>'source' IS DISTINCT FROM 'sheet'), '[]'::jsonb);
      sheet_kept := '[]'::jsonb;
      ov := coalesce(r.sheet_mark_overrides, '[]'::jsonb);
      FOR mark IN
        SELECT e FROM jsonb_array_elements(r.status_marks) WITH ORDINALITY t(e, o)
        WHERE e->>'source' = 'sheet' ORDER BY o
      LOOP
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements(manual) x
          WHERE x->>'note' = mark->>'note'
            AND x->>'start' IS NOT DISTINCT FROM mark->>'start'
            AND x->>'end' IS NOT DISTINCT FROM mark->>'end')
        THEN
          manual := coalesce((
            SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(manual) WITH ORDINALITY t(x, o)
            WHERE NOT (x->>'note' = mark->>'note'
                       AND x->>'start' IS NOT DISTINCT FROM mark->>'start'
                       AND x->>'end' IS NOT DISTINCT FROM mark->>'end')), '[]'::jsonb);
          sheet_kept := sheet_kept || jsonb_build_array(mark);
        ELSIF mark->>'start' IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(manual) x WHERE x->>'start' = mark->>'start')
        THEN
          key := jsonb_build_object('note', mark->>'note', 'start', mark->>'start');
          IF NOT ov @> jsonb_build_array(key) THEN
            ov := ov || jsonb_build_array(key);
          END IF;
        ELSE
          sheet_kept := sheet_kept || jsonb_build_array(mark);
        END IF;
      END LOOP;
      IF (manual || sheet_kept) IS DISTINCT FROM r.status_marks OR ov IS DISTINCT FROM r.sheet_mark_overrides THEN
        EXECUTE format('UPDATE %I.members SET status_marks = $1, sheet_mark_overrides = $2 WHERE id = $3', sch)
          USING manual || sheet_kept, ov, r.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- 이래현: 관리자가 '한국'(2026-06-07~)에 끝나는 날을 적어 풀어 둔 상태에서 시트 표기가 아직 다시
-- 붙기 전이라 위 규칙이 짚을 것이 없을 수 있다 (붙은 뒤라면 위 2번이 이미 처리했다). 그 열쇠를
-- 직접 남기고, 혹시 붙어 있는 시트 표기는 걷는다. 그 사람이 없는 DB(미리보기 브랜치)에서는
-- 아무 줄도 걸리지 않는다.
UPDATE public.members
SET sheet_mark_overrides = sheet_mark_overrides || '[{"note":"한국","start":"2026-06-07"}]'::jsonb
WHERE id = '116aab31-88ff-4081-a98c-983133c3f134'
  AND NOT sheet_mark_overrides @> '[{"note":"한국","start":"2026-06-07"}]'::jsonb;

UPDATE public.members
SET status_marks = coalesce((
  SELECT jsonb_agg(e ORDER BY o) FROM jsonb_array_elements(status_marks) WITH ORDINALITY t(e, o)
  WHERE NOT (e->>'source' = 'sheet' AND e->>'note' = '한국' AND e->>'start' = '2026-06-07')), '[]'::jsonb)
WHERE id = '116aab31-88ff-4081-a98c-983133c3f134'
  AND status_marks @> '[{"source":"sheet","note":"한국","start":"2026-06-07"}]'::jsonb;
