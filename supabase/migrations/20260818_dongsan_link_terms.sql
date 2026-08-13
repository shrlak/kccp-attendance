-- 동산 리더 링크가 학기를 따라 나고 진다.
--
-- ── 왜 ────────────────────────────────────────────────────────────────────────────────
-- 20260817이 낸 링크는 한 번 내면 사람이 거둘 때까지 살아 있었다. 그런데 이 링크는 **한 학기의
-- 담당자**에게 건네는 것이고, 학기가 끝나면 그 사람은 더 이상 그 부서의 명단을 열 이유가 없다.
-- 그 판단을 관리자의 기억에 맡기면 지난 학기 링크가 조용히 살아남는다 — 범위를 짚지 못하는
-- 열쇠를 없앴던 이유(#232)가 시간 축에서 그대로 반복되는 셈이다.
--
-- 그래서 링크에 **자기가 사는 학기**를 적는다. 저장 모양에 칸이 하나 붙는다:
--
--   [ { "token": "2026-fall-college-9f3c…", "group": "대학부", "subgroup": "",
--       "term": "2026-fall", "createdAt": 1723… } ]
--
-- term은 아카이브·동산 스냅숏이 이미 쓰는 그 학기 키다 ("<연도>-<spring|summer|fall>").
-- 규칙은 하나뿐이고 서버가 매 요청에 다시 세운다 (dongsanLink.ts reconcileTermLinks):
--
--     부서 링크는 "지금 학기 × 시트가 담당하지 않는 부서" 만큼 있고, 그 밖에는 없다.
--
-- 학기가 시작하면 그 학기의 링크가 저절로 나고, 학기가 끝나면 저절로 걷힌다. 시트가 붙어 있는
-- 부서에는 애초에 나지 않는다 — 같은 동산을 시트와 링크로 함께 적으면 다음 동기화가 링크로 적은
-- 값을 덮어쓰기 때문이다 (20260816).
--
-- term이 빈 링크는 이 규칙 바깥이다: 동산별로 내던 시절의 링크와, 학기라는 것이 없는 부(장년부)
-- 에서 사람이 손으로 낸 셀 링크. 자동으로 폐기되지 않고 낸 사람이 손으로 거둔다.
--
-- ── 주소에 학기와 부서가 적힌다 ───────────────────────────────────────────────────────
-- 토큰 앞에 사람이 읽는 이름표가 붙는다: `2026-fall-college-…` (대학부) · `2026-fall-young-…`
-- (청년부). 링크를 두 장 이상 나눠 주는 사람이 주소만 보고 어느 학기 어느 부서 것인지 알아야
-- 하기 때문이다. 여는 것은 여전히 뒤에 붙는 무작위 96비트이고, 이름표는 짐작할 수 있어도
-- 열쇠가 아니다. 한글을 주소에 그대로 실으면 복사할 때 %EB%8C%80… 로 바뀌어 아무것도 읽히지
-- 않으므로 옮겨 적었다.
--
-- 칸이 새로 생기는 것은 아니다(jsonb 안이므로) — 이미 저장된 링크는 term이 없는 채로 읽히고,
-- 배포 후 첫 /api/roster에서 규칙에 따라 그 학기의 새 링크로 갈린다. 그래서 이 파일은 저장
-- 모양이 무엇을 뜻하는지만 고쳐 적는다.

-- ── 시트에도 학기가 적힌다 ───────────────────────────────────────────────────────────
-- 링크가 나지 않는 부서는 "시트가 담당하는 부서"다. 그런데 동산 시트는 **학기마다 새로 만드는
-- 물건**이라, 지난 학기 시트가 등록된 채 남아 있다고 해서 이번 학기를 담당하는 것은 아니다.
-- 그 구분이 없으면 2026 여름 시트 한 장이 가을 리더 링크를 영영 막는다. 그래서 sheet_sync의
-- source마다 `term`이 붙고(붙인 날의 학기), 담당 판정은 **이번 학기의 시트만** 센다.
-- 동기화 자체는 학기를 보지 않는다 — 지난 학기 시트를 다시 읽어도 그 학기 날짜에 같은 값이
-- 들어갈 뿐이다.
--
-- 이미 등록된 시트에는 학기를 우리가 적어 준다. 지금 붙어 있는 것은 2026 여름 동산 시트 한
-- 장뿐이고(20260816의 시드), 이 연동 자체가 2026 여름학기 안에서만 존재했으므로 — 학기가 없던
-- 시절에 등록된 시트는 그 학기의 시트일 수밖에 없다.
UPDATE public.config
SET sheet_sync = jsonb_set(sheet_sync, '{sources}', (
      SELECT COALESCE(jsonb_agg(
               CASE WHEN COALESCE(s->>'term', '') = '' THEN s || jsonb_build_object('term', '2026-summer') ELSE s END
               ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(sheet_sync->'sources') WITH ORDINALITY AS t(s, ord)))
WHERE id = 1
  AND jsonb_typeof(sheet_sync->'sources') = 'array'
  -- 학기가 빠진 시트가 하나라도 있을 때만 손댄다 → 다시 돌려도 아무 일이 없다.
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(sheet_sync->'sources') s
        WHERE COALESCE(s->>'term', '') = '');

-- 장년부는 건드리지 않는다: 붙어 있는 시트도 없고, 학기라는 것이 없어 term이 언제나 빈 문자열
-- 이다 (빈 값끼리 맞아떨어져 담당 판정이 그대로 성립한다).

COMMENT ON COLUMN public.config.sheet_sync IS
  '구글 시트 동산 출석 연동 — {token, sources:[{id,gid,title,group,term}], lastRun:{…}}. 토큰은 여기 밖으로 나가지 않는다';
COMMENT ON COLUMN adult.config.sheet_sync IS
  '구글 시트 셀 출석 연동 — {token, sources:[{id,gid,title,group,term}], lastRun:{…}}. 토큰은 여기 밖으로 나가지 않는다';

COMMENT ON COLUMN public.config.dongsan_links IS
  '동산 리더용 출석 링크 — [{token,group,subgroup,term,createdAt}]. 링크 하나가 부서 하나를 가리키고, 학기(term)를 따라 자동으로 나고 폐기된다';
COMMENT ON COLUMN adult.config.dongsan_links IS
  '셀 리더용 출석 링크 — [{token,group,subgroup,term,createdAt}]. 장년부에는 학기가 없어 term은 비어 있고, 사람이 내고 거둔다';
