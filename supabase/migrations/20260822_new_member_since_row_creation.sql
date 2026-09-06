-- new_member_since는 **표시가 붙은 날**이지 등록일이 아니다.
--
-- 20260821의 소급 채우기는 `등록일 ?? 행이 만들어진 날`을 적었는데, 등록일은 사람이 뒤로 적을
-- 수 있는 칸이다: 종이 카드를 나중에 옮겨 적으면서 "실제로 온 날"을 등록일에 넣는다. 그래서
-- 오늘 명단에 올린 사람에게 1년 전 날짜가 적히는 일이 생겼다 — 프로덕션에서 8명(대학·청년부 6 ·
-- 장년부 2)이 **자기 행이 만들어지기도 전의 날짜**를 들고 있다. 그 사람들은 표시를 해제하는
-- 순간 1년이 이미 지난 것으로 읽혀 목록에서 곧바로 사라진다 — 이 칸을 만든 이유가 바로 그
-- 사라짐을 막는 것이었는데.
--
-- 표시는 그 행보다 먼저 붙을 수 없다. 그래서 행이 만들어진 날보다 이른 값은 있을 수 없는
-- 값이고, 그 자리에 되돌려 놓는다. 그 뒤에 붙은 표시(행이 생기고 한참 뒤에 관리자가 켠 것)는
-- 우리가 알 수 없으므로 그대로 두고, 이 이후의 표시는 서버가 그날그날 적는다.
UPDATE public.members
SET new_member_since = created_at::date
WHERE new_member_since IS NOT NULL AND new_member_since < created_at::date;

UPDATE adult.members
SET new_member_since = created_at::date
WHERE new_member_since IS NOT NULL AND new_member_since < created_at::date;

COMMENT ON COLUMN public.members.new_member_since IS
  '새가족 표시가 붙은 날 (등록일이 아니다 — 등록일은 뒤로 적을 수 있다). 표시가 해제돼도 지우지 않는다: 새가족 탭이 이 날로부터 1년간 사람을 남기는 근거';
COMMENT ON COLUMN adult.members.new_member_since IS
  '새가족 표시가 붙은 날 (등록일이 아니다 — 등록일은 뒤로 적을 수 있다). 표시가 해제돼도 지우지 않는다: 새가족 탭이 이 날로부터 1년간 사람을 남기는 근거';
