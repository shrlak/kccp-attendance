-- 출석부 → 구글 시트를 서버가 직접 쓴다 — 링크만 붙여 두면 된다.
--
-- 20260819가 "시트 → 출석부"를 서버가 스스로 당기게 한 것과 같은 장치의 반대 방향이다. 관리자가
-- 설정 탭에 시트 링크를 붙이면 (config.sheet_sync.exportTargets, jsonb 안의 칸이라 스키마 변경이
-- 없다) 서버가 자기 구글 계정(서비스 계정, 환경변수 GOOGLE_SERVICE_ACCOUNT_JSON)으로 그 시트에
-- 부서마다 탭 하나씩 예배 출석표를 쓴다.
--
--   · 이 칸이 곧 청구권이다: /api/roster에 얹힌 쓰기가 쿨다운(기본 10분)마다 한 번만 돌도록,
--     조건부 UPDATE가 성공한 요청 하나만 쓴다 (last_sheet_sync_at · last_auto_backup_at과 같다).
--   · 부마다 자기 칸을 갖는다 (스키마가 갈려 있으므로 이름은 같다).

ALTER TABLE public.config ADD COLUMN IF NOT EXISTS last_sheet_push_at timestamptz;
ALTER TABLE adult.config  ADD COLUMN IF NOT EXISTS last_sheet_push_at timestamptz;

COMMENT ON COLUMN public.config.last_sheet_push_at IS
  '출석부를 구글 시트에 마지막으로 스스로 써 준 시각 — 쿨다운 청구권 (조건부 UPDATE로 잡는다)';
COMMENT ON COLUMN adult.config.last_sheet_push_at IS
  '출석부를 구글 시트에 마지막으로 스스로 써 준 시각 — 쿨다운 청구권 (조건부 UPDATE로 잡는다)';
