import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Home, CheckCircle } from 'lucide-react'
import { BottomNav } from './BottomNav'

const items = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'checkin', label: '출석', icon: CheckCircle },
]

describe('BottomNav', () => {
  it('renders labels and marks the active item', () => {
    render(<BottomNav items={items} active="checkin" onSelect={() => {}} />)
    const active = screen.getByRole('button', { name: '출석' })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '홈' })).not.toHaveAttribute('aria-current')
  })
  it('calls onSelect with the item id', async () => {
    const onSelect = vi.fn()
    render(<BottomNav items={items} active="home" onSelect={onSelect} />)
    screen.getByRole('button', { name: '출석' }).click()
    expect(onSelect).toHaveBeenCalledWith('checkin')
  })
})
