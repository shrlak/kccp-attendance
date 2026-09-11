-- 2024-2025 · Fall 2024 · 2025-2026 새가족 시트에서 이미 등록된 멤버의 빈 칸만 채운다.
-- 규칙 셋: (1) 이름이 정확히 한 명과 맞을 때만, (2) 비어 있는 칸만 (기존 값은 절대 덮지 않는다),
-- (3) 적힌 그대로. 그래서 몇 번을 다시 돌려도 같은 결과다 (두 번째부터는 채울 칸이 없다).
-- 동명이인 김상현(생년월일·전화가 다른 두 사람)은 가려낼 수 없어 제외했다.
with csv(name, gender, birth, phone, email, kakao, school, baptism, faith, reg, note) as (values
  ('이유진','남',date '2004-04-03','323-209-9783','haiz92155@gmail.com','','CMU, CS','유아세례','',date '2024-09-01',''),
  ('이래현','남',date '2001-01-30','412-897-7113','raehyunl@andrew.cmu.edu','','CMU','세례','모태신앙',date '2024-09-01',''),
  ('방소현','여',date '2005-09-11','412-930-5589','cutiepangsh@gmail.com','','Upitt nursing','입교','모태신앙',date '2024-09-01',''),
  ('서혜림','여',date '2005-07-31','551-248-6154','hyerimseo01@gmail.com','','pitt pre - dentistry','해당없음','1년 미만',date '2024-09-01',''),
  ('조수아','여',date '2005-11-09','267-810-3592','ssuah1109@gmail.com','','Pitt CS','세례','5년 이상',date '2024-09-03',''),
  ('박창준','남',date '1994-07-25','4123371523','','','Duquesne University law school','해당없음','',null,''),
  ('백지현','여',date '1999-07-30','412-339-9610','','','Cmu music (voice)','세례','',null,''),
  ('정세빈','남',date '1997-06-21','412-697-7077','vsebin7@gmail.com','','CMU Mechanical Engineering 대학원생','세례','모태신앙',date '2024-09-15',''),
  ('김대영','남',date '1995-10-25','412-977-0343','','','CMU Architecture Undergrad','해당없음','5년 이상',date '2024-11-03','대학생 + 나이때문에 목사님의 허락을 받고 청년부로 받음'),
  ('강소라','여',date '1997-08-20','412-660-0871','','','서울대/CMU 비지팅','유아세례','1년 미만',date '2025-11-02',''),
  ('김기동','남',date '1993-03-03','412-999-0109','','','CMU chem 박사','입교','모태신앙',date '2025-10-12',''),
  ('김석현','남',date '1999-10-28','412-592-2234','Hyun10028@gmail.com','','CMU 대학원생','','',date '2025-08-03',''),
  ('김영균','여',date '1993-11-23','412-339-8900','','','CMU mba (kaist)','해당없음','1년 미만',date '2026-02-01',''),
  ('박성원','남',date '2003-04-18','010-6569-4030','sungwpark@korea.ac.kr','','CMU 연수','입교','',date '2025-08-17','6개월 연수'),
  ('박찬정','남',date '1999-01-05','412-287-9472','','','CMU 6개월 교환학생','유아세례','모태신앙',date '2025-09-07',''),
  ('서수민','여',date '1996-10-25','714-357-8264','','','CMU mba (kaist)','해당없음','',date '2026-02-01',''),
  ('손종현','남',date '1991-09-30','412-579-1045','','','CMU mba (kaist)','해당없음','모태신앙',date '2026-02-01',''),
  ('안여진','여',date '1997-05-04','915-540-5354','','','UPMC Residency','','',date '2025-07-06',''),
  ('유가희','여',date '1990-06-13','412-616-6300','','dbrkgml3kr','Pitt 교육학 석사','세례','',date '2025-08-24','직장생활 하시다가 오심'),
  ('유경훈','남',date '1999-10-14','','','','CMU 대학원','','1년 미만',date '2025-08-31',''),
  ('윤다열','남',date '1995-02-20','615-756-5495','','','Duquesne','입교','모태신앙',date '2025-09-07',''),
  ('이서영','여',date '1996-02-28','4125194923','','','CMU AI','해당없음','1년 미만',date '2026-01-11',''),
  ('이아현','여',date '1998-09-16','469-928-5522','','','Computational Biology','','모태신앙',date '2025-08-31',''),
  ('이찬규','남',date '1996-10-08','408-396-6127','','','MechE','입교','',date '2025-08-31',''),
  ('이충한','남',date '1993-01-09','814-880-5808','chonghan0109@gmail.com','','','','',date '2026-01-18',''),
  ('임채민','여',date '1996-01-13','201-313-6765','chaeminl@andrew.cmu.edu','','CMU - 성악','','',date '2025-08-17','카톡용 번호 (010-6827-5277)'),
  ('정수인','여',date '2000-07-05','412-641-9710','vnsvin75@gmail.com','','CMU/Music','','',date '2025-08-10',''),
  ('정재원','남',date '1995-11-28','412-909-9615','','','서울대','해당없음','1년 미만',date '2026-02-08',''),
  ('주현민','여',date '2002-01-14','448-204-9125','','','','세례','모태신앙',date '2025-08-31',''),
  ('최승재','남',date '1996-05-20','412-608-2346','','','CMU visiting scholar','해당없음','1년 미만',date '2026-02-01',''),
  ('최휘서','남',date '2001-12-14','603-738-0440','','','Pitt Geology','입교','',date '2025-08-17',''),
  ('홍수민','여',date '1998-03-09','617-352-9935','smhong309@gmail.com','','CMU Design','유아세례','모태신앙',date '2025-08-17',''),
  ('황진우','남',date '2000-10-08','412-287-3981','','','CMU 대학원생','','1년 미만',date '2025-08-24','')
),
one as (  -- 이름이 유일한 행만: 열쇠가 이름뿐이라 둘이면 누구인지 짚을 수 없다
  select c.*, m.id
  from csv c
  join public.members m on btrim(m.name) = c.name
  where (select count(*) from public.members q where btrim(q.name) = c.name) = 1
)
update public.members m set
  gender          = coalesce(nullif(m.gender,''),          nullif(o.gender,''),   m.gender),
  birth_date      = coalesce(m.birth_date,                 o.birth),
  phone           = coalesce(nullif(m.phone,''),           nullif(o.phone,''),    m.phone),
  email           = coalesce(nullif(m.email,''),           nullif(o.email,''),    m.email),
  kakao_id        = coalesce(nullif(m.kakao_id,''),        nullif(o.kakao,''),    m.kakao_id),
  school_or_work  = coalesce(nullif(m.school_or_work,''),  nullif(o.school,''),   m.school_or_work),
  baptism_status  = coalesce(nullif(m.baptism_status,''),  nullif(o.baptism,''),  m.baptism_status),
  faith_duration  = coalesce(nullif(m.faith_duration,''),  nullif(o.faith,''),    m.faith_duration),
  registration_date = coalesce(m.registration_date,        o.reg),
  notes           = coalesce(nullif(m.notes,''),           nullif(o.note,''),     m.notes),
  updated_at      = now()
from one o
where m.id = o.id
  -- 채울 칸이 하나라도 있는 행만 건드린다: 다시 돌려도 updated_at조차 움직이지 않는다
  and (   (nullif(m.gender,'')         is null and nullif(o.gender,'')  is not null)
       or (m.birth_date                is null and o.birth              is not null)
       or (nullif(m.phone,'')          is null and nullif(o.phone,'')   is not null)
       or (nullif(m.email,'')          is null and nullif(o.email,'')   is not null)
       or (nullif(m.kakao_id,'')       is null and nullif(o.kakao,'')   is not null)
       or (nullif(m.school_or_work,'') is null and nullif(o.school,'')  is not null)
       or (nullif(m.baptism_status,'') is null and nullif(o.baptism,'') is not null)
       or (nullif(m.faith_duration,'') is null and nullif(o.faith,'')   is not null)
       or (m.registration_date         is null and o.reg                is not null)
       or (nullif(m.notes,'')          is null and nullif(o.note,'')    is not null));
