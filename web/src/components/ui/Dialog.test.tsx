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

  it('renders the modal above the full-screen kiosk layer (z-index > 999)', () => {
    // Regression: the kiosk wraps the screen in a fixed z-[999] container and the dialog
    // portals to <body> as a sibling. A lower modal z-index renders it *behind* the opaque
    // kiosk, so 방문자 체크인 / 새가족 등록 popups silently never appeared.
    render(<Dialog open title="t" onOpenChange={() => {}}><p>x</p></Dialog>)
    const z = Number(screen.getByRole('dialog').className.match(/z-\[(\d+)\]/)?.[1] ?? '0')
    expect(z).toBeGreaterThan(999)
  })
})
