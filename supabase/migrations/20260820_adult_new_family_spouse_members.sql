-- 장년부 새가족 카드에 적힌 배우자를 멤버로 올린다 (이미 등록된 사람들 몫의 소급 적용).
--
-- 장년부 카드는 **세대 단위**다: 본인 칸 아래 동행가족 표에 배우자와 자녀를 적는다. 자녀는
-- 출석을 찍지 않으므로 그 표(`members.family`) 안에 남는 것으로 끝나지만, **배우자는 자기
-- 출석을 찍는다** — 주일마다 키오스크 앞에 서는 사람이 둘인데 명단에 하나뿐이면 나머지 한
-- 사람은 이름을 찾지 못해 손님으로 찍히거나 아예 안 찍힌다.
--
-- 등록 화면은 #255부터 그 배우자를 멤버로 하나 더 만든다 (`features/admin/adultSpouse.ts`).
-- 그런데 그 전에 들어온 카드들은 본인 한 줄로만 남아 있다. 이 마이그레이션이 그 사람들을
-- 뒤늦게 올려 준다 — 규칙도 옮겨 담는 칸도 `spousePayload`와 같은 것이다:
--   · **그 사람의 것**은 그 줄에서   — 이름·영문 이름·성별·생년월일·세례여부
--   · **한 세대의 것**은 카드에서   — 주소·전화·참석동기·교회등록 의사·방문 일자·등록일·
--                                     동행가족 표
--   · **옮기지 않는 것 셋**         — 교우 등록번호(한 사람에게 발급된 번호라 둘이 들면 그
--                                     번호로 사람을 찾을 수 없다), 직장·학교명(카드에 한
--                                     칸뿐이고 그건 본인 것이다), 그리고 **이메일**
--
-- 이메일이 그 셋에 드는 이유는 스키마가 이미 말하고 있다: `members_lower_idx`가 `lower(email)`에
-- 걸린 **유니크 인덱스**다 (email IS NOT NULL인 줄만). 이메일은 이 시스템에서 사람을 가리키는
-- 열쇠라(구글 로그인이 이메일로 members 행을 찾는다) 둘이 같은 값을 들 수 없다 — 교우 등록번호와
-- 똑같은 이유다. 빈 문자열도 인덱스에 들어가므로 ''를 복사해도 두 번째 사람에서 걸린다. 그래서
-- 배우자의 이메일은 **NULL로 둔다** (NULL은 그 인덱스 밖이다); 카드에 적힌 이메일은 그 카드를
-- 쓴 본인에게 남는다.
-- 두 사람을 묶는 값이 `household_id`(20260808)이고, 본인에게 그 값이 없으면 여기서 만든다.
--
-- **기기도 출석도 만들지 않는다.** 이 사람들이 그날 왔다는 기록이 우리에게 없다 — 없는 출석을
-- 지어내는 것이 빠진 사람보다 나쁘다. 멤버 행 하나면 다음 주일에 키오스크에서 자기 이름을
-- 찾을 수 있고, 장년부 멤버 301명 중 298명이 이미 기기 없이 그렇게 있다.

-- ── 1. 배우자가 적힌 새가족에게 세대 묶음을 준다 ───────────────────────────────────────
UPDATE adult.members m
   SET household_id = gen_random_uuid(),
       updated_at   = now()
 WHERE m.is_new_member
   AND m.household_id IS NULL
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(m.family) f
      WHERE lower(btrim(coalesce(f->>'relation', ''))) !~ '처남|처제|처형|처가|처부|처모'
        AND lower(btrim(coalesce(f->>'relation', ''))) ~ '배우자|남편|아내|부인|와이프|처|spouse|husband|wife'
        AND btrim(coalesce(f->>'nameKo', '')) || btrim(coalesce(f->>'nameEn', '')) <> ''
   );

-- ── 2. 그 배우자들을 멤버로 만든다 ─────────────────────────────────────────────────────
WITH spouse AS (
  SELECT
    m.household_id,
    m.group_name, m.phone, m.phone_home, m.address, m.city, m.state, m.zip_code,
    m.attend_reason, m.registration_choice, m.visit_date, m.registration_date, m.family,
    m.name AS host_name,
    btrim(coalesce(f->>'relation', ''))                                   AS relation,
    -- 한글 이름이 먼저, 없으면 영문. 명단의 이름은 한글이 기본이지만 영문만 적힌 카드도
    -- 있고, 그때 빈 이름으로 두면 그 사람을 어디에서도 찾을 수 없다.
    coalesce(nullif(btrim(coalesce(f->>'nameKo', '')), ''),
             btrim(coalesce(f->>'nameEn', '')))                           AS name,
    btrim(coalesce(f->>'nameEn', ''))                                     AS name_en,
    btrim(coalesce(f->>'birthDate', ''))                                  AS birth_raw,
    btrim(coalesce(f->>'baptism', ''))                                    AS baptism,
    -- 성별: 카드 판독이 'M'/'F'로 적어 오는 일이 있는데 이 칸의 말은 '남'/'여'다 (출석부
    -- 엑셀의 칸 색도, 멤버 편집 창의 선택지도 그 말만 안다). 표기를 옮기는 것뿐이라 없던
    -- 사실을 지어내지 않는다 — 모르는 값은 적힌 그대로 둔다.
    CASE upper(btrim(coalesce(f->>'gender', '')))
      WHEN 'M' THEN '남' WHEN 'MALE'   THEN '남'
      WHEN 'F' THEN '여' WHEN 'FEMALE' THEN '여'
      ELSE btrim(coalesce(f->>'gender', ''))
    END                                                                   AS gender
  FROM adult.members m
  CROSS JOIN LATERAL jsonb_array_elements(m.family) AS f
  -- '처남'·'처제'·'처형'은 '처'를 품고 있지만 배우자가 아니라 먼저 걷어낸다. 틀리려면
  -- **놓치는 쪽으로** 틀린다: 배우자를 놓치면 사람이 한 명 빠지지만, 처남을 배우자로 읽으면
  -- 있지도 않은 부부가 명단에 생긴다.
  WHERE m.is_new_member
    AND lower(btrim(coalesce(f->>'relation', ''))) !~ '처남|처제|처형|처가|처부|처모'
    AND lower(btrim(coalesce(f->>'relation', ''))) ~ '배우자|남편|아내|부인|와이프|처|spouse|husband|wife'
)
INSERT INTO adult.members (
  name, name_en, group_name, subgroup, gender, birth_date, birth_date_raw, baptism_status,
  phone, phone_home, address, city, state, zip_code,
  attend_reason, registration_choice, visit_date, registration_date,
  family, household_id, is_new_member, pastoral_visit_requested, notes
)
SELECT DISTINCT ON (s.name)
  s.name,
  s.name_en,
  s.group_name,
  '',
  s.gender,
  -- 종이의 생년월일은 년/월/일 세 칸이라 셋이 다 차야 날짜가 된다.
  CASE WHEN s.birth_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN s.birth_raw::date END,
  -- 날짜가 되지 못한 값은 **적힌 그대로** 남긴다 ("2006", "2006-10"). 1월 1일로 채우면
  -- 있지도 않은 생일이 생기고, 나중에 보는 사람이 적힌 값인지 지어낸 값인지 알 수 없다.
  CASE WHEN s.birth_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN ''
       ELSE coalesce((regexp_match(s.birth_raw, '^([^-]+(?:-[^-]+)*)'))[1], '') END,
  coalesce(nullif(s.baptism, ''), '해당없음'),
  s.phone, s.phone_home, s.address, s.city, s.state, s.zip_code,
  s.attend_reason, s.registration_choice, s.visit_date,
  coalesce(s.registration_date, (now() AT TIME ZONE 'America/New_York')::date),
  -- 동행가족 표는 카드 한 장의 사실이라 양쪽이 같은 목록을 든다 (본인이 배우자의 동행가족
  -- 이기도 하다는 것을, 한 장뿐인 종이는 따로 적지 않는다).
  s.family,
  s.household_id,
  TRUE,
  NULL,
  -- 명단에 사람이 하나 더 생기는 일이라, 나중에 "이 사람은 어디서 왔지"가 되지 않도록
  -- 어느 카드에서 왔는지 적어 둔다.
  '새가족 카드의 배우자 — ' || s.host_name || ' (' || s.relation || ')'
  FROM spouse s
 WHERE s.name <> ''
   -- 이미 그 이름의 장년부 멤버가 있으면 만들지 않는다 (서버의 중복 병합이 이름+부서로 사람을
   -- 찾는 것과 같은 열쇠다). 같은 이름의 다른 사람이어서 걸렸다면 한 명이 빠질 뿐이고, 그건
   -- 멤버 탭에서 손으로 넣을 수 있다 — 반대로 틀리면 없던 사람이 명단에 생긴다.
   AND NOT EXISTS (SELECT 1 FROM adult.members x WHERE x.name = s.name)
 ORDER BY s.name, s.registration_date NULLS LAST;
