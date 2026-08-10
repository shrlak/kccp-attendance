-- 공용 비밀번호 로그인도 비밀번호가 어느 부의 것이었는지로 가른다.
--
-- 20260814는 member_id로 되살릴 수 있는 것만 채우고, 공용 비밀번호 로그인 18건은 전부
-- 비워 뒀다 — "어떤 비밀번호를 쳤는지는 어디에도 남지 않는다"고 보았기 때문이다.
-- 그건 절반만 맞았다. **비밀번호마다 주는 역할이 다르고, 역할은 기록돼 있다.**
--
--   kccpleaders  → leader      ┐
--   kccpwelcome  → welcoming   ├ 대학·청년부에만 있는 비밀번호다. 장년부에는 이 역할로
--   (구) staff   → staff       ┘ 들어오는 비밀번호가 없다 → 부가 하나로 정해진다.
--   kccpadmin    → super_admin ┐ 둘 다 super_admin이라 역할만으로는 갈리지 않는다.
--   kccpadults   → super_admin ┘
--
-- super_admin은 시간으로 한 겹 더 가른다: kccpadults는 장년부가 열린 2026-08-10 03:14 EDT
-- (#222 머지 = 엣지 함수 배포)에 처음 생겼다. **그 전에는 존재하지 않던 비밀번호이므로**,
-- 그 전의 super_admin 공용 로그인은 kccpadmin일 수밖에 없다.
--
-- 그 뒤의 super_admin 공용 로그인은 여전히 갈리지 않는다. 그건 진짜로 알 수 없는 것이라
-- 계속 비워 둔다 — 화면의 '부 미기록'은 이제 딱 그만큼을 뜻한다.
--
-- member_id가 있는 줄은 20260814가 이미 채웠고, 여기서는 NULL인 줄만 건드린다.
-- 새로 쌓이는 로그인에는 부가 처음부터 적히므로(index.ts addLoginLog) 이 규칙이 필요하지 않다.

-- 대학·청년부에만 있는 역할로 들어온 공용 로그인.
UPDATE public.login_log
   SET partition = 'youth'
 WHERE partition IS NULL
   AND role IN ('leader', 'welcoming', 'staff');

-- kccpadults가 아직 없던 시절의 super_admin 공용 로그인.
-- 1786346059000 = 2026-08-10 03:14:19 EDT, ADULT_PASSWORD가 프로덕션에 올라간 순간.
UPDATE public.login_log
   SET partition = 'youth'
 WHERE partition IS NULL
   AND role = 'super_admin'
   AND ts < 1786346059000;
