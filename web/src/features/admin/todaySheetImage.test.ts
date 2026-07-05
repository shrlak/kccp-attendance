import { describe, it, expect } from 'vitest'
import { fitFontPx, slotLabel } from './todaySheetImage'

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
