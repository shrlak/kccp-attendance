-- 한 사람이 구글 계정을 둘 쓰는 경우.
--
-- 구글 로그인은 이메일 하나로 사람을 찾는다 (auth.ts verifyAdminJwt: email → members →
-- member_roles). 그런데 사역용 주소와 개인 주소를 함께 쓰는 사람이 있다 — 어느 쪽으로
-- 들어와도 같은 사람이어야 하는데, 칸이 하나뿐이라 둘 중 하나로만 들어올 수 있었다.
--
-- 사람을 둘로 나누는 방법(같은 이름의 멤버 행을 하나 더 만들기)은 쓰지 않는다: 출석도
-- 둘로 갈라지고 명단에 같은 사람이 두 번 나온다. 칸을 하나 더 두는 편이 정직하다.
--
-- 두 스키마에 똑같이 붙인다. 대학·청년부에도 같은 일이 생길 수 있고, 두 members 표가
-- 서로의 복제본이라는 성질(20260807이 LIKE로 만든)을 여기서 깨뜨릴 이유가 없다.

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS email_alt text;
ALTER TABLE adult.members  ADD COLUMN IF NOT EXISTS email_alt text;

COMMENT ON COLUMN public.members.email_alt IS
  '구글 로그인에 쓰는 두 번째 이메일. email과 동등하게 취급된다 (auth.ts verifyAdminJwt)';
COMMENT ON COLUMN adult.members.email_alt IS
  '구글 로그인에 쓰는 두 번째 이메일. email과 동등하게 취급된다 (auth.ts verifyAdminJwt)';

-- 로그인마다 두 칸을 다 뒤지므로 둘 다 색인한다. 대소문자를 가리지 않고 찾으니(ilike)
-- 색인도 lower()로 건다.
CREATE INDEX IF NOT EXISTS idx_members_email_alt       ON public.members (lower(email_alt));
CREATE INDEX IF NOT EXISTS idx_adult_members_email_alt ON adult.members  (lower(email_alt));
