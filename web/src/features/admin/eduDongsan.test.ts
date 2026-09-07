import { describe, it, expect } from 'vitest'
import type { Member } from '../../lib/api'
import {
  assignEduDongsan,
  ruleForGroup,
  missingTraits,
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
    expect(plan[0].group).toBe('청년부')
    expect(plan[0].total).toBe(7)
    expect(plan[0].sizes).toEqual([3, 2, 2])
    // 이 표본은 어느 칸도 적혀 있지 않으므로 청년부의 여섯 기준이 모두 '셀 수 없음'이다.
    expect(plan[0].missing.map((x) => x.n)).toEqual([7, 7, 7, 7, 7, 7])

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

// ── 대학부의 배정 기준 ──────────────────────────────────────────────────────────────
// 1) 성비를 5:5에 가깝게 · 2) Pitt과 CMU를 반반으로 · 3) 전공이 비슷한 사람을 같은 조로.
// 순서가 곧 우선순위다 (전공만 방향이 반대라 — 모으는 힘이라 — 가장 가볍다).

// 자리를 고정하기 위한 가짜 난수 (mulberry32). 시드를 바꾸면 다른 배치에서 출발한다.
const seededRand = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const college = (id: string, gender: string, school: string, major: string): Member =>
  ({ ...m(id, '대학부'), gender, school_or_work: `${school} ${major}` }) as Member

// 결과를 조별 명단으로 되돌린다 (배정 결과는 사람 → 조 이름이므로).
const groupsOf = (people: Member[], out: { memberId: string; dongsan: string }[]) => {
  const byName = new Map<string, Member[]>()
  for (const a of out) {
    const person = people.find((p) => p.id === a.memberId)!
    byName.set(a.dongsan, [...(byName.get(a.dongsan) ?? []), person])
  }
  return [...byName.values()]
}

describe('eduDongsan — 대학부 배정 기준', () => {
  it('부서마다 기준이 다르다 — 대학부는 학교를 흩고, 청년부는 모은다', () => {
    const college = ruleForGroup('대학부')!
    const young = ruleForGroup('청년부')!
    expect(college.spread.map((t) => t.key)).toEqual(['gender', 'school'])
    expect(college.cluster.map((t) => t.key)).toEqual(['major'])
    expect(young.spread.map((t) => t.key)).toEqual(['gender'])
    expect(young.cluster.map((t) => t.key)).toEqual(['age', 'career', 'school', 'major', 'faith'])
    // 기준이 없는 부서는 무작위 그대로다.
    expect(ruleForGroup('EM')).toBeNull()
    expect(ruleForGroup('')).toBeNull()
  })

  it('성비를 조마다 5:5로 맞춘다', () => {
    const people = [
      college('a', '남', 'CMU', 'Math'), college('b', '남', 'CMU', 'Math'),
      college('c', '남', 'CMU', 'Math'), college('d', '남', 'CMU', 'Math'),
      college('e', '여', 'CMU', 'Math'), college('f', '여', 'CMU', 'Math'),
      college('g', '여', 'CMU', 'Math'), college('h', '여', 'CMU', 'Math'),
    ]
    for (const seed of [1, 2, 3, 4, 5]) {
      const groups = groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))
      expect(groups).toHaveLength(2)
      for (const g of groups) {
        expect(g.filter((p) => p.gender === '남')).toHaveLength(2)
        expect(g.filter((p) => p.gender === '여')).toHaveLength(2)
      }
    }
  })

  it('학교를 조마다 반반으로 맞춘다', () => {
    const people = [
      college('a', '남', 'CMU', 'Math'), college('b', '여', 'CMU', 'Math'),
      college('c', '남', 'CMU', 'Math'), college('d', '여', 'CMU', 'Math'),
      college('e', '남', 'Pitt', 'Math'), college('f', '여', 'Pitt', 'Math'),
      college('g', '남', 'Pitt', 'Math'), college('h', '여', 'Pitt', 'Math'),
    ]
    for (const seed of [7, 8, 9]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        expect(g.filter((p) => (p.school_or_work || '').startsWith('CMU'))).toHaveLength(2)
        expect(g.filter((p) => (p.school_or_work || '').startsWith('Pitt'))).toHaveLength(2)
      }
    }
  })

  it('성비·학교가 어느 쪽이든 같으면 전공이 비슷한 사람끼리 모인다', () => {
    // 넷 다 남·CMU라 1·2번 기준은 어떻게 나눠도 같다 — 그때 3번이 답을 고른다.
    const people = [
      college('bio1', '남', 'CMU', 'Biology'), college('bio2', '남', 'CMU', 'Biology'),
      college('math1', '남', 'CMU', 'Math'), college('math2', '남', 'CMU', 'Math'),
    ]
    for (const seed of [11, 12, 13]) {
      const groups = groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))
      for (const g of groups) {
        const ids = g.map((p) => p.id).sort()
        expect([['bio1', 'bio2'], ['math1', 'math2']]).toContainEqual(ids)
      }
    }
  })

  it('전공보다 성비가 먼저다 — 같은 전공끼리 몰아 성비를 깨지 않는다', () => {
    const people = [
      college('bio남1', '남', 'CMU', 'Biology'), college('bio남2', '남', 'CMU', 'Biology'),
      college('math여1', '여', 'CMU', 'Math'), college('math여2', '여', 'CMU', 'Math'),
    ]
    for (const seed of [21, 22, 23]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        expect(g.filter((p) => p.gender === '남')).toHaveLength(1)
        expect(g.filter((p) => p.gender === '여')).toHaveLength(1)
      }
    }
  })

  it('정보가 없는 사람도 배정에서 빠지지 않는다 (균형 계산에서만 빠진다)', () => {
    const people = [
      college('a', '남', 'CMU', 'Math'),
      { ...m('b', '대학부'), gender: '', school_or_work: '' } as Member,
      college('c', '여', 'Pitt', 'Bio'),
    ]
    const out = assignEduDongsan(people, 2, seededRand(31))
    expect(out).toHaveLength(3)
    // 그 부서의 기준이 보는 칸만 센다 — 대학부는 성별 · 학교 · 전공.
    expect(missingTraits(people, ruleForGroup('대학부'))).toEqual([
      { key: 'gender', n: 1 },
      { key: 'school', n: 1 },
      { key: 'major', n: 1 },
    ])
  })
})

// ── 청년부의 기준 ──────────────────────────────────────────────────────────────────
// 성비만 흩고(5:5), 나머지 넷은 모두 모은다: 비슷한 나이 · 같은 처지(대학원생/직장인) ·
// 같은 학교 · 비슷한 전공 · 비슷한 신앙 연차.
const young = (
  id: string,
  gender: string,
  extra: { born?: string; work?: string; faith?: string } = {},
): Member =>
  ({
    ...m(id, '청년부'),
    gender,
    birth_date: extra.born ?? null,
    school_or_work: extra.work ?? '',
    faith_duration: extra.faith ?? '',
  }) as Member

describe('eduDongsan — 청년부 배정 기준', () => {
  it('성비는 청년부에서도 5:5로 흩는다', () => {
    const people = [
      young('a', '남'), young('b', '남'), young('c', '남'), young('d', '남'),
      young('e', '여'), young('f', '여'), young('g', '여'), young('h', '여'),
    ]
    for (const seed of [1, 2, 3]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        expect(g.filter((p) => p.gender === '남')).toHaveLength(2)
        expect(g.filter((p) => p.gender === '여')).toHaveLength(2)
      }
    }
  })

  it('비슷한 나이끼리 모은다 (±2년)', () => {
    // 성비는 어느 쪽으로 갈라도 같으므로 나이가 답을 고른다.
    const people = [
      young('91a', '남', { born: '1991-03-02' }), young('91b', '여', { born: '1992-05-11' }),
      young('00a', '남', { born: '2000-01-20' }), young('00b', '여', { born: '2001-07-09' }),
    ]
    for (const seed of [4, 5, 6]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        const ids = g.map((p) => p.id).sort()
        expect([['91a', '91b'], ['00a', '00b']]).toContainEqual(ids)
      }
    }
  })

  it('대학원생은 대학원생끼리, 직장인은 직장인끼리 모은다', () => {
    const people = [
      young('grad1', '남', { work: '대학원생 · CMU' }), young('grad2', '여', { work: '대학원생 · CMU' }),
      young('work1', '남', { work: '직장인 · 회사' }), young('work2', '여', { work: '직장인 · 회사' }),
    ]
    for (const seed of [7, 8, 9]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        const ids = g.map((p) => p.id).sort()
        expect([['grad1', 'grad2'], ['work1', 'work2']]).toContainEqual(ids)
      }
    }
  })

  it('비슷한 신앙 연차끼리 모은다', () => {
    const people = [
      young('모태1', '남', { faith: '모태신앙' }), young('모태2', '여', { faith: '모태신앙' }),
      young('새신자1', '남', { faith: '1년 미만' }), young('새신자2', '여', { faith: '1년 미만' }),
    ]
    for (const seed of [10, 11, 12]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        const ids = g.map((p) => p.id).sort()
        expect([['모태1', '모태2'], ['새신자1', '새신자2']]).toContainEqual(ids)
      }
    }
  })

  it('청년부는 같은 학교끼리 모은다 — 대학부와 방향이 반대다', () => {
    const people = [
      young('cmu1', '남', { work: '대학원생 · CMU' }), young('cmu2', '여', { work: '대학원생 · CMU' }),
      young('pitt1', '남', { work: '대학원생 · Pitt' }), young('pitt2', '여', { work: '대학원생 · Pitt' }),
    ]
    for (const seed of [13, 14, 15]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        const ids = g.map((p) => p.id).sort()
        expect([['cmu1', 'cmu2'], ['pitt1', 'pitt2']]).toContainEqual(ids)
      }
    }
  })

  it('성비가 나이보다 먼저다 — 같은 나이끼리 몰면서 성비를 깨지 않는다', () => {
    const people = [
      young('남91', '남', { born: '1991-01-01' }), young('남92', '남', { born: '1992-01-01' }),
      young('여00', '여', { born: '2000-01-01' }), young('여01', '여', { born: '2001-01-01' }),
    ]
    for (const seed of [16, 17, 18]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        expect(g.filter((p) => p.gender === '남')).toHaveLength(1)
        expect(g.filter((p) => p.gender === '여')).toHaveLength(1)
      }
    }
  })

  it('나이가 신앙 연차보다 먼저다 — 낮은 기준이 높은 기준을 뒤집지 못한다', () => {
    // 나이로 묶으면 {91a,91b}·{00a,00b}, 신앙으로 묶으면 {91a,00a}·{91b,00b}. 나이가 이긴다.
    const people = [
      young('91a', '남', { born: '1991-01-01', faith: '모태신앙' }),
      young('91b', '여', { born: '1992-01-01', faith: '1년 미만' }),
      young('00a', '여', { born: '2000-01-01', faith: '모태신앙' }),
      young('00b', '남', { born: '2001-01-01', faith: '1년 미만' }),
    ]
    for (const seed of [19, 20, 21]) {
      for (const g of groupsOf(people, assignEduDongsan(people, 2, seededRand(seed)))) {
        const ids = g.map((p) => p.id).sort()
        expect([['91a', '91b'], ['00a', '00b']]).toContainEqual(ids)
      }
    }
  })

  it('청년부에서 셀 수 없는 칸도 이름으로 적어 준다', () => {
    expect(missingTraits([young('a', '')], ruleForGroup('청년부'))).toEqual([
      { key: 'gender', n: 1 }, { key: 'age', n: 1 }, { key: 'career', n: 1 },
      { key: 'school', n: 1 }, { key: 'major', n: 1 }, { key: 'faith', n: 1 },
    ])
  })
})
