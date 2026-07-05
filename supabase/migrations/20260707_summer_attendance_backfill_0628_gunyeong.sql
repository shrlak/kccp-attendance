-- 건영동산 6/28 예배(worship) attendance backfill from the handwritten on-site sheet.
--
-- Source: the 6/28 handwritten 현장 예배 sign-in sheet (photo, received 2026-07-05).
-- 20260705_summer_attendance_backfill_0628.sql covered 중호/호연/윤서동산 from the
-- master spreadsheet, which had no 6/28 data for 건영동산 — this file fills that gap
-- for 건영동산 only. O = present (one row); X / not on the sheet = no row, so of the
-- 13-member 건영동산 roster the 5 absentees (김꽃별, 김서현(대학부), 양세윤, 조인서,
-- 홍수민) intentionally have no rows. The sheet's un-hearted 김서현 is 김서현(청년부)
-- of 윤서동산, already covered by 20260705.
--
-- Fully additive + idempotent (guarded per member+date), so it is a safe no-op on
-- prod — where it was applied operationally on 2026-07-05 — and reproduces the data
-- on fresh preview branches. Names are matched by (name, 동산). ts values continue
-- the 1782648000000+n sequence started by 20260705.

INSERT INTO attendance_log
  (device_id, member_id, name, group_name, subgroup, date, time_str, ts, is_manual, is_bulk, admin_added)
SELECT
  COALESCE((SELECT id FROM devices d WHERE d.member_id=m.id ORDER BY id LIMIT 1), 'MANUAL-'||m.id),
  m.id, m.name, m.group_name, m.subgroup, v.date::date,
  '12:00:00 PM', v.ts, true, true, true
FROM (VALUES
  ('건영동산','최건영','2026-06-28',1782648000025),
  ('건영동산','이지현(03)','2026-06-28',1782648000026),
  ('건영동산','손하진','2026-06-28',1782648000027),
  ('건영동산','김대균','2026-06-28',1782648000028),
  ('건영동산','박창준','2026-06-28',1782648000029),
  ('건영동산','이아현','2026-06-28',1782648000030),
  ('건영동산','권상운','2026-06-28',1782648000031),
  ('건영동산','방준재','2026-06-28',1782648000032)
) AS v(sub, name, date, ts)
JOIN members m ON m.name=v.name AND m.subgroup=v.sub
WHERE NOT EXISTS (
  SELECT 1 FROM attendance_log al WHERE al.member_id=m.id AND al.date=v.date::date
);
