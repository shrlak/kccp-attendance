import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'

const { copyCanvasToClipboard } = vi.hoisted(() => ({ copyCanvasToClipboard: vi.fn() }))
vi.mock('./todaySheetImage', () => ({ copyCanvasToClipboard }))

import { IndividualImageCopyDialog } from './IndividualImageCopyDialog'

beforeAll(async () => {
  await i18n.init()
  await i18n.changeLanguage('ko')
})

beforeEach(() => {
  copyCanvasToClipboard.mockReset().mockResolvedValue(true)
})

describe('IndividualImageCopyDialog', () => {
  it('copies each canvas from its own user-clicked action', async () => {
    const college = document.createElement('canvas')
    const youngAdult = document.createElement('canvas')
    render(
      <ToastProvider>
        <IndividualImageCopyDialog
          items={[
            { id: 'college', label: '대학부', canvas: college },
            { id: 'young-adult', label: '청년부', canvas: youngAdult },
          ]}
          onClose={vi.fn()}
        />
      </ToastProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: '대학부 복사' }))
    await waitFor(() => expect(copyCanvasToClipboard).toHaveBeenCalledWith(college))
    expect(screen.getByText('1 / 2 복사 완료')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '청년부 복사' }))
    await waitFor(() => expect(copyCanvasToClipboard).toHaveBeenCalledWith(youngAdult))
    expect(copyCanvasToClipboard).toHaveBeenCalledTimes(2)
    expect(screen.getByText('2 / 2 복사 완료')).toBeInTheDocument()
  })
})
