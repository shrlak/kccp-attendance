import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { i18n } from '../../lib/i18n'
import { GroupFilter } from './GroupFilter'
import { NO_FILTER } from './filters'
import type { Member } from '../../lib/api'

beforeAll(async () => { await i18n.init() })

const m = (id: string, group: string, schoolOrWork = ''): Member =>
  ({ id, name: id, group_name: group, subgroup: '', member_role: '', gender: '', phone: '',
     birth_date: null, kakao_id: '', is_new_member: false, notes: '', school_or_work: schoolOrWork }) as Member

const people = [
  m('c', '대학부', '대학생 · CMU Math'),
  m('p', '대학부', '대학생 · UPitt nursing'),
  m('y', '청년부', 'ballet'),
]

describe('GroupFilter — 학교 칩', () => {
  it('CMU · Pitt · 학교 미기재를 고를 수 있다', async () => {
    const onChange = vi.fn()
    render(<GroupFilter members={people} value={NO_FILTER} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Pitt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '학교 미기재' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'CMU' }))
    expect(onChange).toHaveBeenCalledWith({ group: '', subgroup: '', school: 'cmu' })
  })

  it('부서를 바꿔도 고른 학교는 남는다 — 두 가름은 곱해진다', async () => {
    const onChange = vi.fn()
    render(<GroupFilter members={people} value={{ group: '', subgroup: '', school: 'cmu' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '대학부' }))
    expect(onChange).toHaveBeenCalledWith({ group: '대학부', subgroup: '', school: 'cmu' })
  })

  it('아무도 학교를 적지 않은 부에서는 칩 줄이 없다 (장년부)', () => {
    render(<GroupFilter members={[m('a', '장년부'), m('b', '장년부', '직장인 · 회사원')]} value={NO_FILTER} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'CMU' })).toBeNull()
    expect(screen.queryByRole('button', { name: '학교 미기재' })).toBeNull()
  })
})
