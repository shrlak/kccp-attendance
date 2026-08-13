-- 시트 동기화를 서버가 스스로 당긴다 — Apps Script 없이.
--
-- ── 왜 ────────────────────────────────────────────────────────────────────────────────
-- 지금까지 동기화는 **시트가 두드려야** 돌았다: 스프레드시트에 붙인 Apps Script가 편집을 보고
-- /api/sheet/sync를 부르는 방식(20260816). 그런데 그 스크립트는 **탭이 아니라 파일마다 사람이
-- 들어가 붙여넣고 권한을 허용해야** 하고, 스크립트가 없거나 권한이 풀리면 아무 말 없이 조용히
-- 멈춘다 — 관리자는 출석부가 비어 있는 것을 보고서야 안다.
--
-- 그래서 반대로 뒤집는다: **서버가 주기적으로 읽는다.** 앱이 이미 15초마다 부르는 길
-- (/api/roster)에 얹되, 청구권(claim)으로 묶어 쿨다운마다 한 번만 실제로 읽는다. 자동 백업이
-- 쓰는 그 방식 그대로다 (config.last_auto_backup_at) — 화면은 기다리지 않고
-- (EdgeRuntime.waitUntil), 여러 아이솔레이트가 동시에 읽는 일도 없다.
--
--   · 이 칸이 곧 청구권이다: `last_sheet_sync_at`. 조건부 UPDATE가 성공한 요청 하나만 읽는다.
--   · 부서마다 자기 칸을 갖는다 (스키마가 갈려 있으므로 이름은 같다) — 대학·청년부의 시트를
--     읽었다고 장년부 쿨다운이 소모되지 않는다.
--   · 시트를 하나도 붙이지 않은 부에서는 아예 청구하지 않는다 (읽을 것이 없다).
--
-- Apps Script 경로는 그대로 살아 있다 — 붙여 둔 시트는 편집 즉시 반영되고, 없는 시트는 쿨다운
-- 안에 따라온다. 둘이 겹쳐도 같은 값을 다시 쓸 뿐이라 어긋나지 않는다.
--
-- 관리자가 아무도 앱을 열지 않는 동안에는 당기지 않는다. 그때는 읽을 사람도 없기 때문이고,
-- 다음에 누가 열면 그 자리에서 따라온다.

ALTER TABLE public.config ADD COLUMN IF NOT EXISTS last_sheet_sync_at timestamptz;
ALTER TABLE adult.config  ADD COLUMN IF NOT EXISTS last_sheet_sync_at timestamptz;

COMMENT ON COLUMN public.config.last_sheet_sync_at IS
  '구글 시트를 마지막으로 스스로 당겨 읽은 시각 — 쿨다운 청구권 (조건부 UPDATE로 잡는다)';
COMMENT ON COLUMN adult.config.last_sheet_sync_at IS
  '구글 시트를 마지막으로 스스로 당겨 읽은 시각 — 쿨다운 청구권 (조건부 UPDATE로 잡는다)';
