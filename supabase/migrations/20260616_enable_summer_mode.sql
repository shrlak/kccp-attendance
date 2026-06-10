-- Summer semester: automatically combine all 동산 into a single set of 4
-- (건영동산 · 중호동산 · 호연동산 · 윤서동산) with NO differentiation between
-- 대학부 and 청년부. summer_mode makes the app group every 동산 together across
-- 부서, so admins do not have to toggle it manually each summer.
ALTER TABLE config ADD COLUMN IF NOT EXISTS summer_mode BOOLEAN DEFAULT FALSE;
UPDATE config SET summer_mode = TRUE, updated_at = NOW() WHERE id = 1;
