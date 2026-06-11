-- config.officers: the 임원 display-badge roster (member names), managed from the admin
-- UI like config.dongsan_leaders. Seeded with the initial officer list only while empty,
-- so replays never clobber later edits.
ALTER TABLE config ADD COLUMN IF NOT EXISTS officers jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE config
SET officers = '["강혜윤","조인서","심영은","최휘서","박주연","최건영"]'::jsonb
WHERE id = 1 AND officers = '[]'::jsonb;
