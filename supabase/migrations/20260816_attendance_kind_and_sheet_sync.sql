-- 출석 한 줄에 "무엇의 출석인가"를 적고, 구글 시트 연동이 앉을 자리를 만든다.
--
-- ── 왜 kind가 필요한가 ────────────────────────────────────────────────────────────────
-- 동산에서 쓰는 구글 시트는 한 주일에 **두 칸**을 적는다: 예배와 동산모임. 그 둘은 같은
-- 사실이 아니다 — 동산모임에는 왔지만 예배에는 못 온 사람이 실제로 있다(시트에 O/X가
-- 엇갈린 줄이 그것이다). 지금까지 attendance_log는 한 사람 한 날짜에 한 줄이었으므로,
-- 둘 중 하나를 버리거나 둘을 같은 칸에 섞어야 했다. 둘 다 틀린 답이다.
--
-- 그래서 줄에 종류를 적는다. 'worship'이 기존의 그 출석이고 — 키오스크 체크인, 관리자가
-- 손으로 넣은 출석, 지금까지 쌓인 모든 행이 전부 이것이다 — 'dongsan'이 새로 들어오는
-- 동산모임 출석이다. DEFAULT 'worship' + NOT NULL이라 **이미 있는 행은 전부 예배로**
-- 채워지고, 종류를 적지 않는 기존 코드 경로도 예배를 쓴다. 즉 이 마이그레이션 하나로는
-- 화면에서 달라지는 것이 없다.
--
-- ── 왜 source가 필요한가 ──────────────────────────────────────────────────────────────
-- 연동은 시트 → 출석부 단방향이고, 시트에서 O를 X로 고치면 그 출석은 없어져야 한다.
-- 그런데 "없앤다"가 아무 행이나 지우는 것이 되면 안 된다: 그 사람이 키오스크로 직접
-- 찍은 출석까지 시트가 지워버리게 된다. 시트는 **자기가 만든 것만** 되돌릴 수 있어야
-- 하므로, 연동이 넣은 행에 source='sheet'를 적어 둔다. NULL은 앱에서 생긴 행이고,
-- 연동은 그런 행을 절대 지우지 않는다.
--
-- ── 두 스키마에 똑같이 ────────────────────────────────────────────────────────────────
-- 지금 연동을 쓰는 것은 대학·청년부뿐이지만, 두 attendance_log는 서로의 복제본이고
-- (20260807이 LIKE로 만들었다) 그 성질을 여기서 깨뜨릴 이유가 없다. 장년부도 셀 모임
-- 출석을 같은 방식으로 적게 되면 그때 코드만 열면 된다.

ALTER TABLE public.attendance_log ADD COLUMN IF NOT EXISTS kind   text NOT NULL DEFAULT 'worship';
ALTER TABLE adult.attendance_log  ADD COLUMN IF NOT EXISTS kind   text NOT NULL DEFAULT 'worship';
ALTER TABLE public.attendance_log ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE adult.attendance_log  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.attendance_log.kind IS
  '이 출석이 무엇의 출석인가 — worship(주일예배, 기본값) 또는 dongsan(동산/셀 모임)';
COMMENT ON COLUMN adult.attendance_log.kind IS
  '이 출석이 무엇의 출석인가 — worship(주일예배, 기본값) 또는 dongsan(동산/셀 모임)';
COMMENT ON COLUMN public.attendance_log.source IS
  '이 행을 만든 것 — NULL이면 앱(키오스크·관리자), ''sheet''면 구글 시트 연동. 연동은 자기가 만든 행만 지운다';
COMMENT ON COLUMN adult.attendance_log.source IS
  '이 행을 만든 것 — NULL이면 앱(키오스크·관리자), ''sheet''면 구글 시트 연동. 연동은 자기가 만든 행만 지운다';

-- 값이 둘뿐이라는 것은 코드가 아니라 표가 지켜야 한다 — 오타 하나가 출석부에서 조용히
-- 사라지는 행을 만들기 때문. (NOT VALID로 붙였다가 검증하지 않는다: 기존 행은 방금
-- DEFAULT로 채워졌으므로 전부 통과한다.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_log_kind_check') THEN
    ALTER TABLE public.attendance_log ADD CONSTRAINT attendance_log_kind_check
      CHECK (kind IN ('worship', 'dongsan'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adult_attendance_log_kind_check') THEN
    ALTER TABLE adult.attendance_log ADD CONSTRAINT adult_attendance_log_kind_check
      CHECK (kind IN ('worship', 'dongsan'));
  END IF;
END $$;

-- 출석부·통계·오늘 탭은 전부 "이 사람들의 예배 출석"을 묻는다. member_id로 좁힌 뒤
-- kind로 한 번 더 거르므로 두 칸을 함께 색인한다.
CREATE INDEX IF NOT EXISTS idx_attendance_member_kind       ON public.attendance_log (member_id, kind);
CREATE INDEX IF NOT EXISTS idx_adult_attendance_member_kind ON adult.attendance_log  (member_id, kind);

-- 연동이 되돌릴 행을 찾는 경로 (member_id + date + kind + source).
CREATE INDEX IF NOT EXISTS idx_attendance_sheet_source       ON public.attendance_log (source) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adult_attendance_sheet_source ON adult.attendance_log  (source) WHERE source IS NOT NULL;

-- ── 연동 설정 ─────────────────────────────────────────────────────────────────────────
-- 부마다 자기 config 행에 자기 연동 설정을 갖는다 (설정에 _adult 접미사를 쓰지 않는다는
-- 이 프로젝트의 규칙 그대로). 담기는 모양:
--
--   { "token": "<연동 키>",
--     "sources": [ { "id": "<스프레드시트 id>", "gid": "<탭 gid, 없으면 첫 탭>",
--                    "title": "2026 대청부 여름동산 출석",
--                    "group": "" | "대학부" | "청년부" } ],
--     "lastRun": { "at": 1723..., "sourceId": "...", "added": 3, "removed": 1,
--                  "created": ["홍길동"], "unmatched": [...], "errors": [] } }
--
-- group이 소스마다 붙는 이유: 여름학기 시트는 대학·청년부 합동이라 한 장이지만, 봄·가을에는
-- 부서마다 시트가 따로다. 그때 어느 부서의 시트인지는 **시트 안에 적혀 있지 않으므로**
-- (시트에는 동산 이름만 있다) 등록할 때 사람이 정해 주는 수밖에 없다. 합동이면 빈 문자열.
--
-- 토큰은 config에만 산다. /api/config는 무인증 경로지만 필드를 하나씩 골라서 내려주므로
-- (summerMode·학기일정·색만) 이 칸은 그 응답에 실리지 않는다.

ALTER TABLE public.config ADD COLUMN IF NOT EXISTS sheet_sync jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE adult.config  ADD COLUMN IF NOT EXISTS sheet_sync jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.config.sheet_sync IS
  '구글 시트 동산 출석 연동 — {token, sources:[{id,gid,title,group}], lastRun:{…}}. 토큰은 여기 밖으로 나가지 않는다';
COMMENT ON COLUMN adult.config.sheet_sync IS
  '구글 시트 동산 출석 연동 — {token, sources:[{id,gid,title,group}], lastRun:{…}}. 토큰은 여기 밖으로 나가지 않는다';

-- ── 지금 쓰는 시트 하나를 미리 붙여 둔다 ──────────────────────────────────────────────
-- 대학·청년부가 이번 여름에 실제로 쓰고 있는 그 시트다(2026 여름동산 출석). 여름학기는
-- 대학부·청년부가 합동이라 한 장에 두 부서가 섞여 있으므로 group은 빈 문자열 = 합동이다.
-- 봄·가을처럼 부서마다 시트가 갈리는 학기의 링크는 **여기에 넣지 않는다** — 가을 시트는
-- 아직 없고, 없는 링크를 미리 만들어 두면 동기화가 매번 읽지 못하는 시트를 두드리게 된다.
-- 학기가 바뀌어 링크가 나오면 설정 → 구글 시트 연동에서 부서를 골라 붙이면 된다.
--
-- 이미 사람이 무언가 붙여 두었으면(sources가 비어 있지 않으면) 손대지 않는다 — 이 시드는
-- 첫 설정을 대신할 뿐이고, 관리자가 지운 시트를 마이그레이션이 되살려서는 안 된다.
-- 토큰도 없을 때만 낸다(Apps Script에 붙여넣을 그 열쇠).
UPDATE public.config
SET sheet_sync = jsonb_build_object(
      'token', COALESCE(NULLIF(sheet_sync->>'token', ''),
                        replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
      'sources', jsonb_build_array(jsonb_build_object(
        'id',    '1h-yZx96AZ1ikKMP726B9iJUUfvHdCgrfqlKG4yCCw-I',
        'gid',   '',
        'title', '2026 대청부 여름동산 출석',
        'group', '')),
      'lastRun', COALESCE(sheet_sync->'lastRun', 'null'::jsonb))
WHERE id = 1
  -- 배열일 때만 길이를 묻는다 — sources가 없거나(기본값 '{}') json null이면 jsonb_array_length가
  -- 그대로 터지므로, 모양부터 확인하고 비어 있는 것으로 친다.
  AND jsonb_array_length(
        CASE WHEN jsonb_typeof(sheet_sync->'sources') = 'array' THEN sheet_sync->'sources' ELSE '[]'::jsonb END
      ) = 0;
