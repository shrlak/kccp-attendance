-- 출석기록의 이름/부서/동산을 멤버의 현재 값과 맞춘다 (백필).
--
-- attendance_log와 devices는 체크인 시점의 이름·부서·동산을 그대로 복사해서 들고 있고,
-- 출석부는 그 복사본으로 부서·동산 필터를 건다. 그래서 새가족이 먼저 출석한 뒤에 동산에
-- 편성되면, 멤버 탭에는 그 동산으로 보이지만 출석부에서 그 동산으로 필터하면 예전 출석
-- 기록(동산이 비어 있던 시절의 행)이 빠져 두 화면이 어긋났다. 부서를 옮긴 경우도 같다.
--
-- 앞으로는 멤버 수정 API가 변경을 출석기록까지 전파하므로(일괄 동산 이동·멤버 병합은
-- 이미 그렇게 동작한다), 이 마이그레이션은 그 전에 쌓인 행만 한 번 정리한다.
-- WHERE 절이 이미 일치하는 행을 제외하므로 여러 번 실행해도 결과가 같다(멱등).

UPDATE attendance_log a
SET name       = m.name,
    group_name = COALESCE(m.group_name, ''),
    subgroup   = COALESCE(m.subgroup, '')
FROM members m
WHERE m.id = a.member_id
  AND (
    a.name IS DISTINCT FROM m.name
    OR COALESCE(a.group_name, '') IS DISTINCT FROM COALESCE(m.group_name, '')
    OR COALESCE(a.subgroup, '')   IS DISTINCT FROM COALESCE(m.subgroup, '')
  );

-- 방문자(member_id가 없는 행)는 소속 멤버가 없으므로 위 UPDATE가 건드리지 않는다.

UPDATE devices d
SET name       = m.name,
    group_name = COALESCE(m.group_name, ''),
    subgroup   = COALESCE(m.subgroup, '')
FROM members m
WHERE m.id = d.member_id
  AND (
    d.name IS DISTINCT FROM m.name
    OR COALESCE(d.group_name, '') IS DISTINCT FROM COALESCE(m.group_name, '')
    OR COALESCE(d.subgroup, '')   IS DISTINCT FROM COALESCE(m.subgroup, '')
  );
