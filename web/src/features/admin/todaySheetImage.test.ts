import { afterEach, describe, it, expect, vi } from 'vitest'
import { copyCanvasToClipboard, copyCanvasesToClipboard, fitFontPx, slotLabel } from './todaySheetImage'

afterEach(() => {
  vi.unstubAllGlobals()
})

function fakeCanvas(payload: string, succeeds = true): HTMLCanvasElement {
  return {
    toBlob(callback: BlobCallback, type?: string) {
      callback(succeeds ? new Blob([payload], { type }) : null)
    },
  } as HTMLCanvasElement
}

class TestClipboardItem {
  readonly data: Record<string, Blob>

  constructor(data: Record<string, Blob>) {
    this.data = data
  }
}

describe('copyCanvasesToClipboard', () => {
  it('writes every canvas as a separate ClipboardItem in one operation', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write } })

    await expect(copyCanvasesToClipboard([fakeCanvas('대학부'), fakeCanvas('청년부')])).resolves.toBe('copied')

    expect(write).toHaveBeenCalledTimes(1)
    const items = write.mock.calls[0][0] as TestClipboardItem[]
    expect(items).toHaveLength(2)
    expect(items[0]).not.toBe(items[1])
    expect(await items[0].data['image/png'].text()).toBe('대학부')
    expect(await items[1].data['image/png'].text()).toBe('청년부')
  })

  it('does not write a partial clipboard when any canvas conversion fails', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', class {})
    vi.stubGlobal('navigator', { clipboard: { write } })

    await expect(copyCanvasesToClipboard([fakeCanvas('first'), fakeCanvas('second', false)])).resolves.toBe('failed')
    expect(write).not.toHaveBeenCalled()
  })

  it('requests individual controls when Chrome rejects multiple ClipboardItems', async () => {
    const write = vi.fn().mockRejectedValue(new DOMException('Support for multiple ClipboardItems is not implemented.', 'NotAllowedError'))
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write } })

    await expect(copyCanvasesToClipboard([fakeCanvas('first'), fakeCanvas('second')])).resolves.toBe('individual-required')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('copies one image in a Chrome-compatible single-item write', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write } })

    await expect(copyCanvasToClipboard(fakeCanvas('only'))).resolves.toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toHaveLength(1)
  })
})

// A measuring stub: width = characters × font px, with the px read back from
// whatever font string fitFontPx last set — enough to exercise the fit math.
function fakeCtx() {
  const ctx = {
    font: '',
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16)
      return { width: text.length * px } as TextMetrics
    },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

const font = (px: number) => `400 ${px}px "Gowun Dodum", sans-serif`

describe('fitFontPx', () => {
  it('keeps the base size when the text already fits', () => {
    const ctx = fakeCtx()
    expect(fitFontPx(ctx, '홍길동', 166, 18, 11, font)).toBe(18)
    expect(ctx.font).toContain('18px')
  })

  it('shrinks a long name proportionally so it fits the cell', () => {
    const ctx = fakeCtx()
    // 12 chars × 18px = 216 > 166 → floor(18 × 166 / 216) = 13
    const px = fitFontPx(ctx, 'ABCDEFGHIJKL', 166, 18, 11, font)
    expect(px).toBe(13)
    expect(ctx.font).toContain('13px')
    expect(ctx.measureText('ABCDEFGHIJKL').width).toBeLessThanOrEqual(166)
  })

  it('never goes below the minimum size, even for absurdly long text', () => {
    const ctx = fakeCtx()
    const px = fitFontPx(ctx, 'X'.repeat(40), 166, 18, 11, font)
    expect(px).toBe(11)
    expect(ctx.font).toContain('11px')
  })
})

describe('slotLabel', () => {
  it('appends the status icon only when tagged', () => {
    expect(slotLabel('홍길동', null)).toBe('홍길동')
    expect(slotLabel('홍길동', 'newFamily')).toBe('홍길동 ✝️')
    expect(slotLabel('홍길동', 'visitor')).toBe('홍길동 👋')
  })
})
