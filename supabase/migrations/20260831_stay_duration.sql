-- 향후 피츠버그에 머물 기간 — 새가족 등록 카드에 새로 생긴 칸.
--
-- 번호가 20260826에서 20260831로 옮겨졌다: 프로덕션의 schema_migrations에는 이 저장소에
-- 없는 줄이 이미 20260826~20260830까지 들어 있어(slides_*, praise_team_leaders,
-- prod_schema_parity), 같은 번호를 쓰면 **이미 적용된 것으로 간주되어 영영 돌지 않는다**.
-- 실제로 그렇게 되어 함수만 새 컬럼을 쓰고 DB에는 없는 상태가 한 번 났다. 번호는 원격에
-- 실제로 있는 것보다 뒤여야 한다.
--
-- 대학·청년부는 학교를 마치면 떠나는 사람이 많은 부라, "이 사람이 얼마나 여기 있을
-- 예정인가"가 동산 편성·새가족 챙김의 실제 근거다 (종이 카드가 그것을 묻기 시작했다).
-- 값은 카드에 인쇄된 말 그대로 담는다 ('1년 미만' · '2년' · '3년' · '4년' · '기타') —
-- faith_duration과 같은 규칙이라, 카드의 보기가 곧 저장되는 문자열이다.
--
-- 두 스키마 모두에 만든다: 멤버 수정(PUT /api/admin/member)의 COLS는 부를 가리지 않고
-- 같은 이름을 쓰므로, 한쪽에만 있으면 그 부의 저장이 통째로 실패한다. 장년부 카드에는
-- 이 칸이 없어 값이 비어 있을 뿐이다.
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS stay_duration text DEFAULT '';
ALTER TABLE adult.members  ADD COLUMN IF NOT EXISTS stay_duration text DEFAULT '';
