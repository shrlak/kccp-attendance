-- 상태 표기 (status marks): the master sheet's grey "marked-out" cells — 한국 귀국,
-- 이주(방문자), 돌아옴 … — become first-class member fields. A member with a status note
-- has their 출석부 cells from status_start through status_end (NULL = through the term's
-- last shown Sunday) rendered as one grey merged note cell instead of O/X, exactly like
-- the master spreadsheet. 새가족 pre-registration spans need no storage — they derive
-- from is_new_member + registration_date.
--
-- Seeds the five marks present in the 2026-07-05 revision of the 2026 여름 master sheet
-- (spans read off its merged grey cells). 황시연 also gets is_new_member=true: the sheet
-- marks her pre-join 6/7 cell 새가족, but her pre-existing prod row (which the guarded
-- 20260629 insert kept) had the flag unset.
--
-- Idempotent: guarded ADD COLUMNs; the UPDATEs pin fixed values so re-running is a no-op
-- (applied operationally to prod on 2026-07-05; preview branches replay it fresh).

ALTER TABLE members ADD COLUMN IF NOT EXISTS status_note TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS status_start DATE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS status_end DATE;

UPDATE members m SET status_note = v.note, status_start = v.starts::date, status_end = v.ends::date
FROM (VALUES
  ('김서현(대학부)','건영동산','한국 귀국',  '2026-06-21', NULL),
  ('이서영',        '호연동산','한국 귀국',  '2026-07-05', NULL),
  ('김서현(청년부)','윤서동산','한국 귀국',  '2026-07-05', NULL),
  ('이예상',        '윤서동산','돌아옴',     '2026-06-07', '2026-07-12'),
  ('황시연',        '윤서동산','이주(방문자)','2026-06-21', '2026-07-19')
) AS v(name, sub, note, starts, ends)
WHERE m.name = v.name AND m.subgroup = v.sub;

UPDATE members SET is_new_member = true
WHERE name = '황시연' AND subgroup = '윤서동산' AND is_new_member = false;
