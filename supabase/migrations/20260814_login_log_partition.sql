-- 로그인 기록에 "어느 부로 들어왔는가"를 남긴다.
--
-- login_log는 부서를 가리지 않는 공용 표다 — 두 부의 로그인이 한 목록에 섞여 있고, 지금까지
-- 그 줄만 보고는 어느 부의 패널로 들어간 것인지 알 수 없었다. 그런데 한 사람이 두 부를 오갈
-- 수 있게 된 뒤로(auth.ts CROSS_PARTITION_EMAILS) 그것은 사람과 별개의 사실이 되었다:
-- 같은 사람, 같은 기기, 같은 주소라도 **들어간 부는 다를 수 있다.**
--
-- 그래서 로그인마다 그때 들어간 부를 적는다. 멤버의 소속에서 나중에 유도할 수 있는 값이
-- 아니다 — 유도하면 두 부를 오가는 사람의 장년부 로그인이 전부 대학·청년부로 읽힌다.
--
-- ── 지난 기록은 증명되는 만큼만 채운다 ────────────────────────────────────────────────
-- member_id가 있는 로그인은 그 UUID가 어느 스키마의 members에 있느냐로 정해진다 (그때는
-- 부를 고를 수 없었으므로, 그 사람의 부가 곧 들어간 부였다). 공용 비밀번호 로그인에는
-- member_id가 없고, 어떤 비밀번호를 쳤는지는 어디에도 남지 않는다 — super_admin 한 줄만
-- 보고 kccpadmin이었는지 kccpadults였는지 가릴 방법이 없다. **그런 줄은 비워 둔다.**
-- 비워 두면 화면에 '부 미기록'으로 모이고, 그것이 실제로 우리가 아는 전부다.

ALTER TABLE public.login_log ADD COLUMN IF NOT EXISTS partition text;

COMMENT ON COLUMN public.login_log.partition IS
  '이 로그인이 들어간 부 — youth(대학·청년부) 또는 adult(장년부). NULL은 알 수 없음(부가 기록되기 전의 공용 비밀번호 로그인)';

UPDATE public.login_log l SET partition = 'youth'
 WHERE l.partition IS NULL AND l.member_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.members m WHERE m.id = l.member_id);

UPDATE public.login_log l SET partition = 'adult'
 WHERE l.partition IS NULL AND l.member_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM adult.members m WHERE m.id = l.member_id);
