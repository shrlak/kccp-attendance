import { describe, it, expect } from 'vitest'
import {
  presentNamesToday,
  attendanceCount,
  filterByName,
  kioskBlocks,
  todayEntryFor,
  hiddenByStatus,
} from './kiosk'
import type { LogEntry, Member } from '../../lib/api'

const member = (name: string, group: string, role = '', extra: Partial<Member> = {}): Member => ({
  id: name,
  name,
  group_name: group,
  subgroup: '',
  member_role: role,
  gender: '',
  phone: '',
  birth_date: null,
  kakao_id: '',
  is_new_member: false,
  notes: '',
  ...extra,
})

const log = (name: string, date: string, role?: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  name,
  group: '',
  subgroup: '',
  date,
  time: '',
  ts: 0,
  memberRole: role,
  ...extra,
})

describe('kioskBlocks', () => {
  const members = [
    member('A', '대학부'),
    member('B', '대학부'),
    member('C', '청년부'),
    member('D', 'EM'),
    member('V', '대학부', 'visitor'),
  ]

  it('buckets 대학부/청년부 into their own blocks, rest into others', () => {
    const blocks = kioskBlocks(members)
    expect(blocks.depts.map((d) => d.key)).toEqual(['대학부', '청년부'])
    expect(blocks.depts[0].total).toBe(2) // A, B (visitor excluded)
    expect(blocks.depts[0].members.map((m) => m.name)).toEqual(['A', 'B'])
    expect(blocks.depts[1].total).toBe(1) // C
    expect(blocks.others.map((m) => m.name)).toEqual(['D'])
  })

  // 격자가 한 줄씩 채워지므로 블록의 목록 순서가 곧 화면의 읽는 순서다 — 열이 2개(폰 세로)든
  // 4개든 8개든. 예전처럼 열로 미리 나눠 두면 화면의 열 수가 그 수와 다를 때 순서가 깨졌다.
  it('keeps each block as one flat 가나다 list, so any column count reads in order', () => {
    const ten = [...'차자아사마바라다나가'].map((n) => member(n, '대학부'))
    expect(kioskBlocks(ten).depts[0].members.map((m) => m.name)).toEqual([...'가나다라마바사아자차'])
  })

  it('excludes visitors from every bucket', () => {
    const blocks = kioskBlocks(members)
    const all = [...blocks.depts.flatMap((d) => d.members), ...blocks.others]
    expect(all.find((m) => m.name === 'V')).toBeUndefined()
  })

  // 장년부 키오스크는 블록이 하나다. 명단은 서버가 이미 장년부만 내려주므로, 여기서 확인할
  // 것은 대학부/청년부 블록이 빈 칸으로 남지 않는다는 것 — 그리고 어쩌다 다른 부서 사람이
  // 섞여 들어와도 장년부 격자에는 들어가지 않고 아래 "그 외"로 빠진다는 것.
  it('장년부 kiosk draws one 부서 block, not the 대학부/청년부 pair', () => {
    const adults = [member('갑', '장년부'), member('을', '장년부'), member('X', '청년부')]
    const blocks = kioskBlocks(adults, 'adult')
    expect(blocks.depts.map((d) => d.key)).toEqual(['장년부'])
    expect(blocks.depts[0].members.map((m) => m.name)).toEqual(['갑', '을'])
    expect(blocks.others.map((m) => m.name)).toEqual(['X'])
  })

  it('defaults to the 대학·청년부 blocks when no 부 is given', () => {
    expect(kioskBlocks(members).depts.map((d) => d.key)).toEqual(['대학부', '청년부'])
  })

  it('sorts each 부서 bucket 가나다 순 regardless of roster order', () => {
    const unordered = [member('다영', '대학부'), member('가영', '대학부'), member('나영', '대학부')]
    expect(kioskBlocks(unordered).depts[0].members.map((m) => m.name)).toEqual(['가영', '나영', '다영'])
  })

  // 기기 언어가 영어여도 한글 이름이 가나다 순으로 먼저 온다 — 기본 정렬은 영문을 앞에 세운다.
  it('puts Korean names first in 가나다 order, English names after, whatever the device locale', () => {
    const mixed = [member('Daniel', '대학부'), member('박지민', '대학부'), member('alex', '대학부'), member('강민', '대학부')]
    expect(kioskBlocks(mixed).depts[0].members.map((m) => m.name)).toEqual(['강민', '박지민', 'alex', 'Daniel'])
  })

  it('sorts others 가나다 순 too', () => {
    const unordered = [member('나', 'EM'), member('가', 'EM')]
    expect(kioskBlocks(unordered).others.map((m) => m.name)).toEqual(['가', '나'])
  })
})

describe('presentNamesToday', () => {
  it('collects distinct names present on the date', () => {
    const entries = [log('A', '2026-06-07'), log('B', '2026-06-07'), log('A', '2026-05-31')]
    const s = presentNamesToday(entries, '2026-06-07')
    expect([...s].sort()).toEqual(['A', 'B'])
  })
})

describe('attendanceCount', () => {
  it('counts unique people for today, including visitors', () => {
    const entries = [
      log('A', '2026-06-07'),
      log('A', '2026-06-07'), // duplicate name → counted once
      log('B', '2026-06-07'),
      log('G', '2026-06-07', 'visitor'), // visitor → included in the head count
      log('C', '2026-05-31'), // other day → excluded
    ]
    expect(attendanceCount(entries, '2026-06-07')).toBe(3)
  })
})

describe('filterByName', () => {
  const members = [member('Anna', '대학부'), member('Bob', '청년부'), member('Chan', '대학부')]
  it('returns all members for an empty query', () => {
    expect(filterByName(members, '   ')).toHaveLength(3)
  })
  it('filters case-insensitively by substring', () => {
    expect(filterByName(members, 'an').map((m) => m.name)).toEqual(['Anna', 'Chan'])
  })
})

describe('todayEntryFor (tap-to-undo lookup)', () => {
  const m = member('A', '대학부')
  it("finds today's entry by member id, ignoring other days", () => {
    const entries = [
      log('A', '2026-06-28', undefined, { id: 1, memberId: 'A' }),
      log('A', '2026-07-05', undefined, { id: 2, memberId: 'A' }),
    ]
    expect(todayEntryFor(entries, '2026-07-05', m)?.id).toBe(2)
  })
  it('falls back to a name match only for rows without a member id', () => {
    const entries = [
      log('A', '2026-07-05', undefined, { id: 3, memberId: 'someone-else' }),
      log('A', '2026-07-05', undefined, { id: 4, memberId: null }),
    ]
    expect(todayEntryFor(entries, '2026-07-05', m)?.id).toBe(4)
  })
  it('returns undefined when the member has no entry today', () => {
    const entries = [log('B', '2026-07-05', undefined, { id: 5, memberId: 'B' })]
    expect(todayEntryFor(entries, '2026-07-05', m)).toBeUndefined()
  })
})

describe('hiddenByStatus (이주/한국 귀국 hidden from the kiosk)', () => {
  const today = '2026-07-05'
  it('hides 한국 귀국 and 이주 while the span covers today (open-ended end)', () => {
    expect(hiddenByStatus(member('A', '대학부', '', { status_note: '한국 귀국', status_start: '2026-06-21', status_end: null }), today)).toBe(true)
    expect(hiddenByStatus(member('B', '대학부', '', { status_note: '이주(방문자)', status_start: '2026-06-21', status_end: '2026-07-19' }), today)).toBe(true)
  })
  it('shows them again outside the span', () => {
    expect(hiddenByStatus(member('A', '대학부', '', { status_note: '한국 귀국', status_start: '2026-07-12', status_end: null }), today)).toBe(false)
    expect(hiddenByStatus(member('B', '대학부', '', { status_note: '이주', status_start: '2026-06-01', status_end: '2026-06-28' }), today)).toBe(false)
  })
  it('never hides other notes (돌아옴) or members without a status', () => {
    expect(hiddenByStatus(member('C', '대학부', '', { status_note: '돌아옴', status_start: '2026-06-07', status_end: '2026-07-12' }), today)).toBe(false)
    expect(hiddenByStatus(member('D', '대학부'), today)).toBe(false)
  })
  it('hides 방학 while the span covers today, but not once it starts later', () => {
    expect(hiddenByStatus(member('F', '대학부', '', { status_note: '방학', status_start: '2026-06-21', status_end: null }), today)).toBe(true)
    expect(hiddenByStatus(member('G', '대학부', '', { status_note: '여름방학', status_start: '2026-07-12', status_end: null }), today)).toBe(false)
  })
  it('ignores a note without a start date (mirrors the 출석부 rule)', () => {
    expect(hiddenByStatus(member('E', '대학부', '', { status_note: '이주' }), today)).toBe(false)
  })
})
