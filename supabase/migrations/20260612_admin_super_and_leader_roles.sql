-- Restrict super-admin powers and assign 리더 (leader) admin roles.
--   • 박주연 (ROSTER-44) is granted Super Admin, alongside the existing 김호연.
--   • Every 동산지기 / 부동산지기 EXCEPT 김호연 is granted the 'leader' admin role,
--     scoped to their own 부서 + 동산 (so a 리더 only sees/edits their 동산):
--       최건영·권상운 → 청년부 건영동산   최중호·주현민 → 청년부 중호동산
--       신주원         → 청년부 호연동산   구윤서·최휘서 → 청년부 윤서동산
--       이지현(06)     → 대학부 윤서동산
--   • 김호연 keeps Super Admin and is intentionally NOT given a 리더 role.
--
-- admin_devices is otherwise runtime state (managed from the Admins tab), so this
-- MERGES rather than overwrites: existing entries for devices NOT listed here (e.g.
-- a real phone device already granted access) are preserved, and the roster entries
-- below are (re)written to the roles shown. Idempotent: re-running yields the same set.
WITH managed AS (
  SELECT '[
    {"role":"super","deviceId":"ROSTER-25"},
    {"role":"super","deviceId":"ROSTER-44"},
    {"role":"leader","deviceId":"ROSTER-01","group":"청년부","subgroup":"건영동산","ministry":"KM"},
    {"role":"leader","deviceId":"ROSTER-02","group":"청년부","subgroup":"건영동산","ministry":"KM"},
    {"role":"leader","deviceId":"ROSTER-13","group":"청년부","subgroup":"중호동산","ministry":"KM"},
    {"role":"leader","deviceId":"ROSTER-14","group":"청년부","subgroup":"중호동산","ministry":"KM"},
    {"role":"leader","deviceId":"ROSTER-26","group":"청년부","subgroup":"호연동산","ministry":"KM"},
    {"role":"leader","deviceId":"ROSTER-37","group":"청년부","subgroup":"윤서동산","ministry":"KM"},
    {"role":"leader","deviceId":"ROSTER-38","group":"대학부","subgroup":"윤서동산","ministry":"KM"},
    {"role":"leader","deviceId":"ROSTER-39","group":"청년부","subgroup":"윤서동산","ministry":"KM"}
  ]'::jsonb AS arr
),
managed_ids AS (
  SELECT e->>'deviceId' AS id
  FROM managed m, jsonb_array_elements(m.arr) e
),
kept AS (
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) AS arr
  FROM config c, jsonb_array_elements(c.admin_devices) e
  WHERE c.id = 1
    AND (e->>'deviceId') NOT IN (SELECT id FROM managed_ids)
)
UPDATE config
  SET admin_devices = (SELECT arr FROM kept) || (SELECT arr FROM managed),
      updated_at = NOW()
  WHERE id = 1;
