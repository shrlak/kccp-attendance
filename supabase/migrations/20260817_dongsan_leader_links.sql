-- 동산 리더가 자기 동산의 동산모임 출석만 적을 수 있는 링크.
--
-- ── 왜 링크인가 ───────────────────────────────────────────────────────────────────────
-- 여름에는 동산 출석이 구글 시트에 모였고 서버가 그 시트를 읽는다(20260816). 그런데 가을
-- 시트는 아직 없고, 학기마다 시트를 새로 만들고 공개로 돌리고 스크립트를 붙이는 일은 매번
-- 사람 손이 든다. 동산지기가 실제로 하는 일은 "이번 주 우리 동산 누가 왔나"를 적는 것뿐이라,
-- 그것만 할 수 있는 자리를 앱 안에 두고 링크로 건네주면 시트가 없어도 된다.
--
-- ── 왜 사람마다가 아니라 동산마다인가 ─────────────────────────────────────────────────
-- 이 프로젝트는 공용 비밀번호로 들어온 리더가 실제로는 명단 전체를 보고 있었다는 이유로
-- 리더 공용 비밀번호를 없앴다(#232). 링크도 같은 잣대를 받는다: 링크 하나가 동산 하나를
-- 가리키고, 그 링크로는 그 동산의 동산원과 그들의 동산모임 출석밖에 보이지 않는다. 이름·
-- 연락처·예배 출석·통계는 이 문으로 나가지 않는다. 링크가 새면 새는 것은 그 동산 하나뿐이고,
-- 관리자는 그 링크만 폐기하면 된다.
--
--   [ { "token": "<링크 열쇠>", "group": "" | "대학부" | "청년부",
--       "subgroup": "호연선규", "createdAt": 1723... } ]
--
-- group이 비어 있으면 부서를 가리지 않는다 — 여름 합동처럼 같은 이름의 동산이 두 부서에
-- 걸쳐 있을 때다. 봄·가을처럼 부서마다 동산이 갈리면 그 부서 이름이 들어간다.
--
-- 토큰은 config 안에만 산다. /api/config는 무인증 경로지만 필드를 골라서 내려주므로
-- (summerMode·학기일정·색) 이 칸은 그 응답에 실리지 않는다 — sheet_sync.token과 같다.

ALTER TABLE public.config ADD COLUMN IF NOT EXISTS dongsan_links jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE adult.config  ADD COLUMN IF NOT EXISTS dongsan_links jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.config.dongsan_links IS
  '동산 리더용 출석 링크 — [{token,group,subgroup,createdAt}]. 링크 하나가 동산 하나만 가리킨다';
COMMENT ON COLUMN adult.config.dongsan_links IS
  '셀 리더용 출석 링크 — [{token,group,subgroup,createdAt}]. 링크 하나가 셀 하나만 가리킨다';
