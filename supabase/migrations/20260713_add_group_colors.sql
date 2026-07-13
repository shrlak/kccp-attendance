-- config.group_colors: super-admin-configurable accent hex colors per 부서 (대학부/청년부),
-- driving the 오늘 tab's name icons, the kiosk's per-부서 tile backgrounds, and the 멤버
-- 탭's per-부서 card backgrounds. Keyed by group name; the client falls back to a built-in
-- default (DEFAULT_GROUP_COLORS) for any group not present here.
ALTER TABLE config ADD COLUMN IF NOT EXISTS group_colors jsonb NOT NULL DEFAULT '{"대학부":"#E0A800","청년부":"#3B82F6"}'::jsonb;
