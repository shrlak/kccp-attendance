-- Seed the four 동산 and their members from the church roster.
--   group_name = 부서 (대학부/청년부)   subgroup = 동산   gender = 성별
--   member_role left empty; 동산지기/부동산지기 are stored in config.dongsan_leaders below.
--   is_new_member = FALSE: these are established members, NOT 새가족, so they do
--   not appear on the 새가족 tab (which is reserved for newly-registered people).
-- NOTE: Two distinct people are both named 김서현, so they are disambiguated by 부서
--   (김서현(대학부) / 김서현(청년부)) — the app keys members by name and would
--   otherwise merge them into one person.
-- Idempotent: stable text ids + ON CONFLICT DO NOTHING. Devices are created without
-- any real device (no kiosk/phone required) — purely roster entries.

INSERT INTO devices (id, name, group_name, subgroup, gender, is_new_member) VALUES
  -- 건영동산
  ('ROSTER-01','최건영','청년부','건영동산','남',FALSE),
  ('ROSTER-02','권상운','청년부','건영동산','남',FALSE),
  ('ROSTER-03','김꽃별','청년부','건영동산','여',FALSE),
  ('ROSTER-04','김대균','청년부','건영동산','남',FALSE),
  ('ROSTER-05','김서현(대학부)','대학부','건영동산','여',FALSE),
  ('ROSTER-06','박창준','청년부','건영동산','남',FALSE),
  ('ROSTER-07','방준재','청년부','건영동산','남',FALSE),
  ('ROSTER-08','손하진','청년부','건영동산','남',FALSE),
  ('ROSTER-09','양세윤','대학부','건영동산','여',FALSE),
  ('ROSTER-10','이아현','청년부','건영동산','여',FALSE),
  ('ROSTER-11','이지현(03)','대학부','건영동산','여',FALSE),
  ('ROSTER-12','조인서','대학부','건영동산','남',FALSE),
  -- 중호동산
  ('ROSTER-13','최중호','청년부','중호동산','남',FALSE),
  ('ROSTER-14','주현민','청년부','중호동산','여',FALSE),
  ('ROSTER-15','김기동','청년부','중호동산','남',FALSE),
  ('ROSTER-16','김지원','청년부','중호동산','여',FALSE),
  ('ROSTER-17','김지환','대학부','중호동산','남',FALSE),
  ('ROSTER-18','백승환','청년부','중호동산','남',FALSE),
  ('ROSTER-19','심영은','대학부','중호동산','여',FALSE),
  ('ROSTER-20','양세진','대학부','중호동산','여',FALSE),
  ('ROSTER-21','이충한','청년부','중호동산','남',FALSE),
  ('ROSTER-22','정세빈','청년부','중호동산','남',FALSE),
  ('ROSTER-23','조예은','청년부','중호동산','여',FALSE),
  ('ROSTER-24','최이삭','대학부','중호동산','남',FALSE),
  -- 호연동산
  ('ROSTER-25','김호연','대학부','호연동산','남',FALSE),
  ('ROSTER-26','신주원','청년부','호연동산','남',FALSE),
  ('ROSTER-27','김택승','청년부','호연동산','남',FALSE),
  ('ROSTER-28','박시내','대학부','호연동산','여',FALSE),
  ('ROSTER-29','서혜림','대학부','호연동산','여',FALSE),
  ('ROSTER-30','양세현','청년부','호연동산','여',FALSE),
  ('ROSTER-31','이경헌','대학부','호연동산','남',FALSE),
  ('ROSTER-32','이래현','청년부','호연동산','남',FALSE),
  ('ROSTER-33','이서영','청년부','호연동산','여',FALSE),
  ('ROSTER-34','임재현','대학부','호연동산','남',FALSE),
  ('ROSTER-35','전은성','청년부','호연동산','여',FALSE),
  ('ROSTER-36','전제연','청년부','호연동산','여',FALSE),
  -- 윤서동산
  ('ROSTER-37','구윤서','청년부','윤서동산','여',FALSE),
  ('ROSTER-38','이지현(06)','대학부','윤서동산','여',FALSE),
  ('ROSTER-39','최휘서','청년부','윤서동산','남',FALSE),
  ('ROSTER-40','김대영','청년부','윤서동산','남',FALSE),
  ('ROSTER-41','김서현(청년부)','청년부','윤서동산','여',FALSE),
  ('ROSTER-42','김석현','청년부','윤서동산','남',FALSE),
  ('ROSTER-43','문지언','대학부','윤서동산','여',FALSE),
  ('ROSTER-44','박주연','청년부','윤서동산','여',FALSE),
  ('ROSTER-45','서범진','대학부','윤서동산','남',FALSE),
  ('ROSTER-46','유가희','청년부','윤서동산','여',FALSE),
  ('ROSTER-47','유경훈','청년부','윤서동산','남',FALSE),
  ('ROSTER-48','이예상','대학부','윤서동산','남',FALSE)
ON CONFLICT (id) DO NOTHING;

-- 동산 names per 부서 (both 부서 share the same four 동산) and 동산지기/부동산지기.
-- getDongsanRole(name, group, subgroup) looks up config.dongsan_leaders[group][subgroup],
-- so each leader/sub-leader is recorded under their own 부서.
--   건영동산: 동산지기 최건영(청년부)  · 부동산지기 권상운(청년부)
--   중호동산: 동산지기 최중호(청년부)  · 부동산지기 주현민(청년부)
--   호연동산: 동산지기 김호연(대학부)  · 부동산지기 신주원(청년부)
--   윤서동산: 동산지기 구윤서(청년부)  · 부동산지기 이지현(06)(대학부)
UPDATE config SET
  dongsan_names = '{"대학부":["건영동산","중호동산","호연동산","윤서동산"],"청년부":["건영동산","중호동산","호연동산","윤서동산"]}'::jsonb,
  dongsan_leaders = '{
    "청년부":{
      "건영동산":{"leader":"최건영","subLeaders":["권상운"]},
      "중호동산":{"leader":"최중호","subLeaders":["주현민"]},
      "호연동산":{"leader":"","subLeaders":["신주원"]},
      "윤서동산":{"leader":"구윤서","subLeaders":[]}
    },
    "대학부":{
      "호연동산":{"leader":"김호연","subLeaders":[]},
      "윤서동산":{"leader":"","subLeaders":["이지현(06)"]}
    }
  }'::jsonb,
  updated_at = NOW()
WHERE id = 1;
