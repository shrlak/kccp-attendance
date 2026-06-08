import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('shows content when open and exposes an accessible title', () => {
    render(<Dialog open title="환영합니다" onOpenChange={() => {}}><p>body</p></Dialog>)
    expect(screen.getByRole('dialog', { name: '환영합니다' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
  it('fires onOpenChange(false) when the close button is pressed', async () => {
    let open = true
    render(<Dialog open title="t" onOpenChange={(v) => (open = v)}><p>x</p></Dialog>)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(open).toBe(false)
  })
})
