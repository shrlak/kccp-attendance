-- 장년부: **빈 이메일은 값이 아니라 NULL이다.**
--
-- `adult.members.members_lower_idx`는 `lower(email)`에 걸린 유니크 인덱스다 (email IS NOT NULL인
-- 줄만). 이메일이 이 시스템에서 사람을 가리키는 열쇠이기 때문인데(구글 로그인이 이메일로 members
-- 행을 찾는다), **빈 문자열도 email IS NOT NULL이라 그 인덱스에 들어간다**. 그래서 이메일을 적지
-- 않은 사람이 둘이 되는 순간 두 번째 INSERT가 통째로 거절되고, 등록 화면에는 이유를 알 수 없는
-- "Could not create member"만 남았다. 종이 카드의 이메일 칸은 자주 비어 있고 — 필수 칸을 없앤
-- 뒤로는 더 그렇다 — 그래서 이 한 줄이 장년부 새가족 등록 전체를 막고 있었다.
--
-- 고치는 자리는 셋이고 이 파일은 그중 데이터베이스 쪽이다:
--   ① 이미 들어 있는 빈 문자열을 NULL로 되돌린다 (프로덕션에 한 줄 있었다).
--   ② 인덱스가 빈 문자열을 아예 세지 않게 한다 — 어느 경로가 실수로 ''를 적어도 다시는 등록이
--      막히지 않는다. 이메일이 **있는** 사람들 사이의 유일성은 그대로다.
-- (③ 엣지 함수와 웹이 빈 칸을 NULL로 보낸다 — 같은 커밋.)
--
-- public(대학·청년부)에는 이 인덱스가 없으므로 손대지 않는다.

UPDATE adult.members SET email = NULL WHERE email IS NOT NULL AND btrim(email) = '';

DROP INDEX IF EXISTS adult.members_lower_idx;
CREATE UNIQUE INDEX IF NOT EXISTS members_lower_idx
  ON adult.members (lower(email))
  WHERE email IS NOT NULL AND btrim(email) <> '';
