import { describe, it, expect } from 'vitest'
import type { Member } from '../../lib/api'
import {
  assignEduDongsan,
  bucketSizes,
  clearEduDongsan,
  eduDongsanLabel,
  eduDongsanPlan,
  groupByEduDongsan,
  membersByGroup,
} from './eduDongsan'

const m = (id: string, group: string, dongsan = ''): Member =>
  ({ id, name: id, group_name: group, subgroup: '', member_role: '', gender: '', phone: '',
     birth_date: null, kakao_id: '', is_new_member: true, notes: '', new_member_dongsan: dongsan }) as Member

// 순환하는 가짜 난수 — 섞는 결과를 고정해 두고 나눗셈만 본다.
const seeded = (seq: number[]) => {
  let i = 0
  return () => seq[i++ % seq.length]
}

describe('eduDongsan — 부서를 넘지 않는다', () => {
  const people = [m('대1', '대학부'), m('청1', '청년부'), m('대2', '대학부'), m('청2', '청년부'), m('청3', '청년부')]

  it('부서별로 갈라 담는다', () => {
    expect(membersByGroup(people).map((g) => [g.group, g.members.length])).toEqual([
      ['대학부', 2],
      ['청년부', 3],
    ])
  })

  it('조 이름에 부서가 붙는다 — 두 부서의 1동산이 같은 이름을 가지면 안 되므로', () => {
    expect(eduDongsanLabel('대학부', 1)).toBe('대학부 1동산')
    expect(eduDongsanLabel('', 3)).toBe('3동산')
  })

  it('배정된 조는 언제나 그 사람의 부서 것이다', () => {
    const byId = new Map(assignEduDongsan(people, 2, seeded([0.1, 0.7, 0.3])).map((a) => [a.memberId, a.dongsan]))
    for (const p of people) expect(byId.get(p.id)!.startsWith(p.group_name)).toBe(true)
    // 부서마다 자기 조가 따로 선다 — 대학부 2명이 2동산으로 갈라지고 청년부 3명도 그렇다.
    expect(new Set([...byId.values()])).toEqual(
      new Set(['대학부 1동산', '대학부 2동산', '청년부 1동산', '청년부 2동산']),
    )
  })
})

describe('eduDongsan — 인원은 고르게, 미리보기와 결과가 같게', () => {
  it('앞쪽 조부터 한 명씩 더 간다 (차이는 1명 이하)', () => {
    expect(bucketSizes(7, 3)).toEqual([3, 2, 2])
    expect(bucketSizes(6, 3)).toEqual([2, 2, 2])
    expect(bucketSizes(2, 5)).toEqual([1, 1, 0, 0, 0]) // 사람보다 조가 많으면 빈 조가 남는다
  })

  it('실제 배정의 조별 인원이 미리보기와 일치한다', () => {
    const people = Array.from({ length: 7 }, (_, i) => m(`청${i}`, '청년부'))
    const plan = eduDongsanPlan(people, 3)
    expect(plan).toEqual([{ group: '청년부', total: 7, sizes: [3, 2, 2] }])

    const counts = new Map<string, number>()
    for (const a of assignEduDongsan(people, 3, seeded([0.9, 0.2, 0.5, 0.7, 0.1, 0.4])))
      counts.set(a.dongsan, (counts.get(a.dongsan) || 0) + 1)
    expect([...counts.entries()].sort()).toEqual([
      ['청년부 1동산', 3],
      ['청년부 2동산', 2],
      ['청년부 3동산', 2],
    ])
  })

  it('아무도 빠뜨리지 않고, 한 사람은 한 조에만 들어간다', () => {
    const people = Array.from({ length: 9 }, (_, i) => m(`p${i}`, i % 2 ? '대학부' : '청년부'))
    const out = assignEduDongsan(people, 4)
    expect(out).toHaveLength(9)
    expect(new Set(out.map((a) => a.memberId)).size).toBe(9)
  })

  it('무작위이지만 매번 섞인다 — 같은 사람이 늘 같은 조로 가지 않는다', () => {
    const people = Array.from({ length: 8 }, (_, i) => m(`p${i}`, '청년부'))
    const first = assignEduDongsan(people, 2, seeded([0.05, 0.95, 0.4, 0.6, 0.15, 0.85, 0.25]))
    const second = assignEduDongsan(people, 2, seeded([0.9, 0.1, 0.75, 0.3, 0.55, 0.2, 0.65]))
    expect(first).not.toEqual(second)
  })
})

describe('eduDongsan — 해제와 조별 명단', () => {
  it('해제는 빈 값을 보낸다 (서버가 ""를 해제로 읽는다)', () => {
    expect(clearEduDongsan([m('a', '청년부', '청년부 1동산')])).toEqual([{ memberId: 'a', dongsan: '' }])
  })

  it('조별로 묶어 이름순으로 돌려준다 — 배정 안 된 사람은 빠진다', () => {
    const groups = groupByEduDongsan([
      m('나', '청년부', '청년부 2동산'),
      m('가', '청년부', '청년부 1동산'),
      m('다', '청년부', '청년부 1동산'),
      m('라', '청년부', ''),
    ])
    expect(groups.map((g) => [g.name, g.members.map((x) => x.name)])).toEqual([
      ['청년부 1동산', ['가', '다']],
      ['청년부 2동산', ['나']],
    ])
  })

  it('조는 숫자로 세운다 — 글자만으로는 10동산이 2동산 앞에 온다', () => {
    const groups = groupByEduDongsan([
      m('a', '청년부', '청년부 10동산'),
      m('b', '청년부', '청년부 2동산'),
      m('c', '대학부', '대학부 1동산'),
    ])
    expect(groups.map((g) => g.name)).toEqual(['대학부 1동산', '청년부 2동산', '청년부 10동산'])
  })
})
