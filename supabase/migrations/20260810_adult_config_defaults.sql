-- adult.config의 부서별 칸을 장년부 것으로 바로잡는다.
--
-- adult.config는 `LIKE public.config INCLUDING ALL`로 만들어졌으므로 칸의 **기본값까지** 그대로
-- 복제됐다. 그래서 갓 만든 장년부 설정 행에 대학·청년부의 동산 이름과 부서 색이 들어가 있다:
--   dongsan_names = {"대학부":[…], "청년부":[…]}   group_colors = {"대학부":…, "청년부":…}
-- 장년부에는 그런 부서가 없으니 설정 탭이 남의 부서 이름을 그리게 된다.
--
-- 엣지 함수의 defaultDongsanNames('adult') / defaultGroupColors('adult')와 같은 값으로 맞춘다.
-- **이미 장년부 키가 들어 있으면 손대지 않는다** — 그건 교회가 실제로 편성해 둔 셀이다.

UPDATE adult.config
   SET dongsan_names = jsonb_build_object('장년부', '["1셀","2셀","3셀","4셀"]'::jsonb),
       updated_at    = now()
 WHERE id = 1
   AND NOT (coalesce(dongsan_names, '{}'::jsonb) ? '장년부');

UPDATE adult.config
   SET group_colors = jsonb_build_object('장년부', '#10B981'),
       updated_at   = now()
 WHERE id = 1
   AND NOT (coalesce(group_colors, '{}'::jsonb) ? '장년부');

-- 새가족 교육은 장년부에 없다 (대학·청년부의 2주 과정이다) — 그 동산 목록도 비워 둔다.
UPDATE adult.config
   SET new_member_dongsan_names = '[]'::jsonb
 WHERE id = 1
   AND coalesce(new_member_dongsan_names, '[]'::jsonb) <> '[]'::jsonb;
