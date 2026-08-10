import { describe, it, expect } from 'vitest'
import {
  ADULT_GROUP,
  YOUTH_GROUPS,
  groupsOfPartition,
  partitionOfGroup,
  subgroupsResetEachTerm,
  summerAppliesTo,
  unitTerms,
} from './partition'

// 부(部) 분리의 규칙은 서버 auth.ts와 같아야 한다. 화면 쪽이 다른 규칙을 갖게 되면 "보이는
// 목록"과 "저장 가능한 값"이 어긋나 저장할 때만 403이 나는 식으로 틀어진다.
describe('partition', () => {
  it('장년부만 adult, 나머지는 전부 youth', () => {
    expect(partitionOfGroup(ADULT_GROUP)).toBe('adult')
    expect(partitionOfGroup('대학부')).toBe('youth')
    expect(partitionOfGroup('청년부')).toBe('youth')
    expect(partitionOfGroup('EM')).toBe('youth')
  })

  // 부서가 비어 있는 행(방문자·예전 기록)은 지금까지 대학·청년부 화면에 떠 왔다 —
  // 장년부가 생겼다고 그 행들이 사라지거나 장년부로 넘어가서는 안 된다.
  it('부서가 없는 행은 대학·청년부에 남는다', () => {
    expect(partitionOfGroup('')).toBe('youth')
    expect(partitionOfGroup(null)).toBe('youth')
    expect(partitionOfGroup(undefined)).toBe('youth')
  })

  it('부서 목록은 부마다 자기 것뿐 — 서로 섞이지 않는다', () => {
    expect(groupsOfPartition('youth')).toEqual([...YOUTH_GROUPS])
    expect(groupsOfPartition('adult')).toEqual([ADULT_GROUP])
    expect(groupsOfPartition('youth')).not.toContain(ADULT_GROUP)
  })

  // 여름 합동은 대학부·청년부를 한 덩어리로 묶는 장치다. 장년부에는 묶을 상대가 없다.
  it('여름 합동은 대학·청년부에만 있다', () => {
    expect(summerAppliesTo('youth')).toBe(true)
    expect(summerAppliesTo('adult')).toBe(false)
  })
})

// 같은 칸(members.subgroup)을 부서마다 다르게 부른다: 대학·청년부는 동산·동산지기·부동산지기,
// 장년부는 셀·셀장·부셀장. 번역 파일 밖에서 조립되는 라벨(엑셀·PDF·출석부)이 이 표를 쓴다.
describe('unitTerms — 동산 / 셀', () => {
  it('대학·청년부는 동산 어휘', () => {
    expect(unitTerms('youth', 'ko')).toEqual({
      unit: '동산', leader: '동산지기', subLeader: '부동산지기', unassigned: '동산 미지정',
    })
  })

  it('장년부는 셀 어휘', () => {
    expect(unitTerms('adult', 'ko')).toEqual({
      unit: '셀', leader: '셀장', subLeader: '부셀장', unassigned: '셀 미지정',
    })
  })

  it('영어에서도 갈린다', () => {
    expect(unitTerms('adult', 'en').leader).toBe('Cell leader')
    expect(unitTerms('adult', 'en').subLeader).toBe('Assistant cell leader')
    expect(unitTerms('youth', 'en').leader).toBe('Dongsan leader')
  })

  it('기본값은 한국어', () => {
    expect(unitTerms('adult')).toEqual(unitTerms('adult', 'ko'))
  })
})

// 셀 이름은 고정이다: 대학·청년부의 동산은 학기마다 새로 짜지만, 장년부의 셀은 이름도 소속도
// 그대로 두고 셀장·부셀장만 바뀐다. 서버 롤오버(RESETS_SUBGROUPS_EACH_TERM)와 같은 규칙이라야
// 화면이 "학기가 끝나 편성이 비워졌다"는 잘못된 안내를 내지 않는다.
describe('subgroupsResetEachTerm', () => {
  it('동산은 학기마다 초기화, 셀은 고정', () => {
    expect(subgroupsResetEachTerm('youth')).toBe(true)
    expect(subgroupsResetEachTerm('adult')).toBe(false)
  })
})
