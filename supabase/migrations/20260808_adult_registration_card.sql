-- 장년부 새교우 방문·등록 카드가 받는 항목들.
--
-- 장년부 카드는 대학·청년부 것과 양식이 다르다: 이름을 한글/영문 두 칸으로 받고, 전화를
-- 휴대폰과 집/기타로 나누고, 참석동기(이사·방문·연수·유학)와 교회등록 의사를 묻고, 주소를
-- City/State/Zip으로 쪼개고, 무엇보다 **동행가족을 최대 5명까지** 같은 카드에 적는다.
--
-- 두 부서가 스키마로 갈라져 있으니(20260807) 이 칸들은 adult.members에만 붙인다 —
-- 대학·청년부 카드는 한 글자도 바뀌지 않는다. 스키마를 나눈 값을 여기서 처음 돌려받는 셈이다.

ALTER TABLE adult.members
  -- 이름: 카드가 한글과 영문을 따로 받는다 (기존 name = 한글, 영문 성명이 여기).
  ADD COLUMN IF NOT EXISTS name_en             text DEFAULT '',
  -- 전화번호: 휴대폰(기존 phone)과 집/기타.
  ADD COLUMN IF NOT EXISTS phone_home          text DEFAULT '',
  -- 주소: 카드가 도로명 한 줄 + City / State / Zip code로 나눠 받는다.
  ADD COLUMN IF NOT EXISTS address             text DEFAULT '',
  ADD COLUMN IF NOT EXISTS city                text DEFAULT '',
  ADD COLUMN IF NOT EXISTS state               text DEFAULT '',
  ADD COLUMN IF NOT EXISTS zip_code            text DEFAULT '',
  -- 참석동기: 이사 / 방문 / 연수 / 유학 (+ 직장 또는 학교명은 기존 school_or_work).
  ADD COLUMN IF NOT EXISTS attend_reason       text DEFAULT '',
  -- 교회등록 여부: register(등록을 원합니다) / later(나중에 결정) / pastor(목사님 연락·상담 원함).
  ADD COLUMN IF NOT EXISTS registration_choice text DEFAULT '',
  -- 카드 머리의 두 칸: 방문 일자와 교우 등록번호.
  ADD COLUMN IF NOT EXISTS visit_date          date,
  ADD COLUMN IF NOT EXISTS member_no           text DEFAULT '',
  -- 동행가족 — 카드의 다섯 줄 그대로:
  --   [{nameKo, nameEn, relation, birthDate, gender}]
  -- 별도 표를 만들지 않은 이유: 이 사람들은 출석을 찍지 않는다 (배우자처럼 본인도 등록하는
  -- 경우에는 아래 household_id로 두 멤버 행이 묶인다). 카드 한 장이 곧 이 목록이다.
  ADD COLUMN IF NOT EXISTS family              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 같은 카드(같은 세대)로 등록된 사람들을 묶는다. 부부는 각자 출석을 찍어야 하므로 멤버 행이
  -- 둘이지만, 주소·전화·자녀는 한 세대의 것이다.
  ADD COLUMN IF NOT EXISTS household_id        uuid;

COMMENT ON COLUMN adult.members.family IS
  '동행가족 [{nameKo,nameEn,relation,birthDate,gender}] — 카드의 다섯 줄. 출석 대상은 아니다';
COMMENT ON COLUMN adult.members.household_id IS
  '같은 세대(같은 카드)로 등록된 멤버들을 묶는 값. 부부는 각자 행을 갖되 이 값이 같다';
COMMENT ON COLUMN adult.members.attend_reason IS
  '참석동기: moved(이사) / visiting(방문) / training(연수) / study(유학)';
COMMENT ON COLUMN adult.members.registration_choice IS
  '교회등록 여부: register(등록 원함) / later(나중에 결정) / pastor(목사님 연락·상담 원함)';

-- 세대별로 카드를 펼칠 때 쓴다.
CREATE INDEX IF NOT EXISTS idx_adult_members_household ON adult.members(household_id);
