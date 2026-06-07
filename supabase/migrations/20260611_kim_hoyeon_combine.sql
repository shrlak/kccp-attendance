-- Combine the 김호연 (대학부) records into a single, consistent person.
-- There were two device rows for 김호연 in 대학부 — one seeded with the 호연동산
-- assignment (ROSTER-25) and one self-registered device that originally had no
-- 동산. They are the same person, so every 김호연 / 대학부 device is normalized to
-- the 호연동산 동산 here. Because the app keys members by name, the two devices
-- already render as one person; this migration just guarantees their 동산 matches.
-- Idempotent: only rows that diverge from 호연동산 are touched.
UPDATE devices
  SET subgroup = '호연동산',
      updated_at = NOW()
  WHERE name = '김호연'
    AND group_name = '대학부'
    AND COALESCE(subgroup, '') <> '호연동산';
