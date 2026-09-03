import { describe, it, expect } from 'vitest'
import { boardBlocks, currentColumn } from './board'
import type { DongsanBoardMember } from '../../lib/api'

const m = (id: string, name: string, subgroup: string, extra: Partial<DongsanBoardMember> = {}): DongsanBoardMember =>
  ({ id, name, group: '대학부', subgroup, ...extra })

describe('boardBlocks', () => {
  const members = [
    m('m1', '김출석', '건영동산'),
    m('m2', '박결석', '건영동산'),
    m('m3', '한지기', '건영동산'),
    m('m4', '최윤서', '윤서동산'),
  ]
  const leaders = { 건영동산: { leader: '한지기', subLeaders: ['박결석'] } }

  it('groups by 동산 and seats 동산지기 → 부동산지기 → the rest', () => {
    const blocks = boardBlocks({ members, leaders })
    expect(blocks.map((b) => b.subgroup)).toEqual(['건영동산', '윤서동산'])
    expect(blocks[0].rows.map((r) => [r.member.name, r.role])).toEqual([
      ['한지기', '동산지기'],
      ['박결석', '부동산지기'],
      ['김출석', null],
    ])
    expect(blocks[0].leader).toBe('한지기')
    expect(blocks[0].subLeaders).toEqual(['박결석'])
  })

  // 이 화면은 동산모임 출석을 적는 자리라, 동산이 없는 사람에게는 적을 모임이 없다.
  it('leaves out anyone without a 동산 — no 미지정 block', () => {
    const blocks = boardBlocks({ members: [...members, m('m5', '다미지정', ''), m('m6', '공백', '   ')], leaders })
    expect(blocks.map((b) => b.subgroup)).toEqual(['건영동산', '윤서동산'])
  })

  // 귀국·이주처럼 명단에서 빠진 사람은 앱 어디에서도 보이지 않는다 (lib/status.ts).
  it('leaves out anyone a hiding status mark covers', () => {
    const gone = m('m7', '이귀국', '건영동산', { status_marks: [{ note: '한국 귀국', start: '2026-07-01', end: null }] })
    const blocks = boardBlocks({ members: [...members, gone], leaders })
    expect(blocks[0].rows.map((r) => r.member.name)).not.toContain('이귀국')
  })

  it('is fine with a 동산 nobody leads', () => {
    const blocks = boardBlocks({ members, leaders: {} })
    expect(blocks[0].rows.map((r) => r.member.name)).toEqual(['김출석', '박결석', '한지기'])
    expect(blocks[0].rows.every((r) => r.role === null)).toBe(true)
    expect(blocks[0].leader).toBe('')
  })
})

describe('currentColumn', () => {
  const dates = ['2026-09-06', '2026-09-13', '2026-09-20']

  it('is the Sunday of the week we are in', () => {
    expect(currentColumn(dates, '2026-09-16')).toBe('2026-09-13')
    expect(currentColumn(dates, '2026-09-13')).toBe('2026-09-13')
  })

  it('falls on the first Sunday before the term starts, the last one after it ends', () => {
    expect(currentColumn(dates, '2026-09-03')).toBe('2026-09-06')
    expect(currentColumn(dates, '2026-12-25')).toBe('2026-09-20')
    expect(currentColumn([], '2026-09-16')).toBe('')
  })
})
