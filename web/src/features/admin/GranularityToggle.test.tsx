import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { i18n } from '../../lib/i18n'
import { GranularityToggle } from './AnalyticsCharts'

beforeAll(async () => { await i18n.init() })

describe('GranularityToggle', () => {
  it('marks the current unit pressed — one of the two is always on', async () => {
    const onChange = vi.fn()
    render(<GranularityToggle value="week" onChange={onChange} />)
    expect(screen.getByRole('button', { name: '주별' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '월별' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(screen.getByRole('button', { name: '월별' }))
    expect(onChange).toHaveBeenCalledWith('month')
  })
})
