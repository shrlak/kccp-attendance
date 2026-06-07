-- 새가족 교육 (new-member education) completion tracking.
-- Two weekly sessions: 새가족교육 1주차 / 2주차. Admins check these off on the 새가족 tab.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS new_member_edu_week1 BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS new_member_edu_week2 BOOLEAN DEFAULT FALSE;
