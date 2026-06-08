import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>체크인</Button>)
    expect(screen.getByRole('button', { name: '체크인' })).toBeInTheDocument()
  })
  it('applies the primary variant by default', () => {
    render(<Button>go</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-primary')
  })
  it('renders the secondary variant', () => {
    render(<Button variant="secondary">x</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-surface')
  })
  it('is non-interactive when disabled', () => {
    render(<Button disabled>x</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
