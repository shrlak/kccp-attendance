import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Input } from './Input'
import { Tag } from './Tag'
import { Card } from './Card'
import { Select } from './Select'

describe('primitives', () => {
  it('Input forwards placeholder + value', () => {
    render(<Input placeholder="이름" defaultValue="민준" />)
    const el = screen.getByPlaceholderText('이름') as HTMLInputElement
    expect(el.value).toBe('민준')
  })
  it('Tag renders its content with a tone class', () => {
    render(<Tag tone="primary">대학부</Tag>)
    const el = screen.getByText('대학부')
    expect(el).toBeInTheDocument()
    expect(el.className).toMatch(/rounded-full/)
  })
  it('Card renders children', () => {
    render(<Card>hello</Card>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
  it('Select renders options', () => {
    render(<Select aria-label="부서"><option value="대학부">대학부</option></Select>)
    expect(screen.getByRole('combobox', { name: '부서' })).toBeInTheDocument()
  })
})
