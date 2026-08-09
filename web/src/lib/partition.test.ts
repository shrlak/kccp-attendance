import { describe, it, expect } from 'vitest'
import {
  ADULT_GROUP,
  YOUTH_GROUPS,
  groupsOfPartition,
  partitionOfGroup,
  summerAppliesTo,
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
