-- 2026 여름동산 예배(worship) attendance backfill for 6/28 from the master sheet.
--
-- Source: the 2026-07-05 revision of the 2026 여름 master attendance spreadsheet.
-- It adds the 6/28 예배 column; 동산모임 stays intentionally excluded and the
-- 6/7–6/21 columns are unchanged from 20260629_summer_attendance_backfill.sql
-- (verified 1:1 against prod before writing this file). 건영동산 recorded no 6/28
-- data and 7/5 is still blank, so neither appears here. O = present (one row);
-- X / blank / notes (한국 귀국 etc.) = no row. All members already exist on the
-- roster, so unlike 20260629 there is no members/devices section.
--
-- Fully additive + idempotent (guarded per member+date), so it is a safe no-op on
-- prod — where it was applied operationally on 2026-07-05 — and reproduces the
-- data on fresh preview branches. Names are matched by (name, 동산).

INSERT INTO attendance_log
  (device_id, member_id, name, group_name, subgroup, date, time_str, ts, is_manual, is_bulk, admin_added)
SELECT
  COALESCE((SELECT id FROM devices d WHERE d.member_id=m.id ORDER BY id LIMIT 1), 'MANUAL-'||m.id),
  m.id, m.name, m.group_name, m.subgroup, v.date::date,
  '12:00:00 PM', v.ts, true, true, true
FROM (VALUES
  ('중호동산','최중호','2026-06-28',1782648000000),
  ('중호동산','주현민','2026-06-28',1782648000001),
  ('중호동산','이충한','2026-06-28',1782648000002),
  ('중호동산','정세빈','2026-06-28',1782648000003),
  ('중호동산','최이삭','2026-06-28',1782648000004),
  ('중호동산','백승환','2026-06-28',1782648000005),
  ('중호동산','김기동','2026-06-28',1782648000006),
  ('중호동산','심영은','2026-06-28',1782648000007),
  ('중호동산','조예은','2026-06-28',1782648000008),
  ('중호동산','양세진','2026-06-28',1782648000009),
  ('중호동산','김지환','2026-06-28',1782648000010),
  ('호연동산','신주원','2026-06-28',1782648000011),
  ('호연동산','김택승','2026-06-28',1782648000012),
  ('호연동산','임재현','2026-06-28',1782648000013),
  ('호연동산','양세현','2026-06-28',1782648000014),
  ('호연동산','전은성','2026-06-28',1782648000015),
  ('호연동산','전제연','2026-06-28',1782648000016),
  ('윤서동산','구윤서','2026-06-28',1782648000017),
  ('윤서동산','이지현(06)','2026-06-28',1782648000018),
  ('윤서동산','서범진','2026-06-28',1782648000019),
  ('윤서동산','박주연','2026-06-28',1782648000020),
  ('윤서동산','유가희','2026-06-28',1782648000021),
  ('윤서동산','문지언','2026-06-28',1782648000022),
  ('윤서동산','장시원','2026-06-28',1782648000023),
  ('윤서동산','김서현(청년부)','2026-06-28',1782648000024)
) AS v(sub, name, date, ts)
JOIN members m ON m.name=v.name AND m.subgroup=v.sub
WHERE NOT EXISTS (
  SELECT 1 FROM attendance_log al WHERE al.member_id=m.id AND al.date=v.date::date
);
