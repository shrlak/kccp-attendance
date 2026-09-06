-- 새가족 표시가 **언제 붙었는지**를 남기는 칸.
--
-- 지금까지 새가족 여부는 참/거짓 한 칸(is_new_member)뿐이라 시간이 없었다. 그래서 표시를
-- 해제하는 순간 그 사람은 새가족 탭에서 **즉시** 사라지고, 방금까지 챙기던 사람이 화면에서
-- 지워진 것인지 원래 없던 것인지 알 방법이 없었다. 새가족팀이 "이제 새가족이 아니다"라고
-- 판단하는 것과 "이 사람을 더 이상 안 봐도 된다"는 것은 같은 날의 일이 아니다 — 표시를
-- 내린 뒤에도 한동안은 여전히 근황을 챙기는 대상이다.
--
-- 그래서 표시가 처음 붙은 날을 적어 두고, 표시가 내려간 뒤에도 그날로부터 1년 동안은
-- 새가족 탭에 남긴다 (web/src/features/admin/newFamily.ts NEW_FAMILY_MEMORY_DAYS).
-- **한 번 적히면 지우지 않는다** — 지우면 "한 번 새가족이었다"는 사실 자체가 사라진다.
--
-- 두 스키마에 똑같이 붙인다 (20260807이 LIKE로 만든 두 members 표의 복제 관계를 유지).

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS new_member_since date;
ALTER TABLE adult.members  ADD COLUMN IF NOT EXISTS new_member_since date;

COMMENT ON COLUMN public.members.new_member_since IS
  '새가족 표시가 처음 붙은 날. 표시가 해제돼도 지우지 않는다 — 새가족 탭이 이 날로부터 1년간 사람을 남기는 근거';
COMMENT ON COLUMN adult.members.new_member_since IS
  '새가족 표시가 처음 붙은 날. 표시가 해제돼도 지우지 않는다 — 새가족 탭이 이 날로부터 1년간 사람을 남기는 근거';

-- 이미 새가족으로 표시돼 있는 사람들에게 소급해 적는다. 그 날짜가 기록된 적이 없으므로
-- 가장 가까운 사실로 대신한다: 등록일자(= 새가족으로 명단에 오른 날), 없으면 행이 만들어진
-- 날. 표시가 없는 사람은 비워 둔다 — 붙은 적이 없다고 단정할 수는 없지만, 붙었었다는 증거도
-- 없는 자리에 날짜를 지어 넣으면 그 사람이 1년 동안 새가족 탭에 나타난다.
UPDATE public.members
SET new_member_since = coalesce(registration_date, created_at::date)
WHERE is_new_member AND new_member_since IS NULL;

UPDATE adult.members
SET new_member_since = coalesce(registration_date, created_at::date)
WHERE is_new_member AND new_member_since IS NULL;
