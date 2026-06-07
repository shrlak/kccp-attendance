-- Register 이경헌 (대학부) as a 새가족 so he appears on the 새가족 tab.
-- He keeps his 동산 assignment (호연동산); marking is_new_member only adds him to
-- the 새가족 list. A current-semester registration_date is set so he shows under
-- the active (summer) semester heading. Updated by name to cover every linked
-- device. 이경헌 is a unique name in the roster, so no disambiguation is needed.
UPDATE devices
  SET is_new_member = TRUE,
      registration_date = COALESCE(registration_date, '2026-06-07'),
      updated_at = NOW()
  WHERE name = '이경헌';
