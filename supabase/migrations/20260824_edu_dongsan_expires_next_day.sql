-- 새가족 교육 동산은 **그날 하루짜리**다.
--
-- `members.new_member_dongsan`이 담는 것은 "그 주일 교육 시간에 어느 자리에 앉는가"이고,
-- 그 시간이 지나면 가리키는 것이 없어진다. 다음 교육은 다음 바퀴에 다시 배정하므로, 그
-- 사이에 남아 있는 값은 "지난주 것"인지 "이번 주 것"인지 화면만 보고는 알 수 없다.
--
-- 그래서 **배정한 날**을 config에 적어 두고(부마다 자기 config 행), 날이 바뀐 뒤 첫
-- /api/roster에서 그 부의 값을 지운다 (엣지 함수 expireEduDongsan — 학기 종료 롤오버와
-- 같은 시계다). 컬럼이 없으면 지울 근거가 없어 값이 영영 남는다.
ALTER TABLE public.config ADD COLUMN IF NOT EXISTS edu_dongsan_date date;
ALTER TABLE adult.config  ADD COLUMN IF NOT EXISTS edu_dongsan_date date;

COMMENT ON COLUMN public.config.edu_dongsan_date IS
  '새가족 교육 동산을 마지막으로 배정한 날 (Eastern). 이 날이 지나면 다음 /api/roster가 members.new_member_dongsan을 비운다. NULL = 지울 것이 없음.';

-- 이 규칙이 서기 전에 배정된 값들. 날짜가 없으면 영영 남으므로 **오늘 배정한 것으로 친다** —
-- 그러면 오늘 것은 오늘 하루를 살고 내일 지워지고, 더 오래된 것도 내일 같이 걷힌다. 지금
-- 지워 버리면 오늘 배정해 둔 조가 그 자리에서 사라진다.
UPDATE public.config SET edu_dongsan_date = (now() AT TIME ZONE 'America/New_York')::date
 WHERE id = 1 AND edu_dongsan_date IS NULL
   AND EXISTS (SELECT 1 FROM public.members WHERE coalesce(new_member_dongsan,'') <> '');

UPDATE adult.config SET edu_dongsan_date = (now() AT TIME ZONE 'America/New_York')::date
 WHERE id = 1 AND edu_dongsan_date IS NULL
   AND EXISTS (SELECT 1 FROM adult.members WHERE coalesce(new_member_dongsan,'') <> '');
