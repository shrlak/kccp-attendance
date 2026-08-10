import * as RDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /** Card-style dialogs (새가족 등록 카드) spread fields across columns and need more width. */
  wide?: boolean
  /**
   * 장년부 새교우 카드는 종이가 더 옆으로 길다 — 주소 줄이 City/State/Zip으로 나뉘고
   * 동행가족 표가 일곱 열이다. wide(720px)로는 그 표가 다 들어가지 않아 옆으로 밀어야
   * 했다. 카드를 좁히는 대신 창을 넓힌다: 읽는 사람이 종이와 같은 배치를 봐야 하므로.
   */
  xwide?: boolean
}

export function Dialog({ open, onOpenChange, title, children, wide, xwide }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {/* z-index must clear the full-screen kiosk layer (KioskView: fixed inset-0 z-[999]).
          The dialog portals to <body>, a sibling of that layer, so a lower z-index would
          render the modal *behind* the opaque kiosk and it would silently not appear.
          Kept below the toast viewport (z-[1100]) so toasts still surface over dialogs. */}
      <RDialog.Portal>
        <RDialog.Overlay className="fx-fade fixed inset-0 z-[1000] bg-black/40 backdrop-blur-[3px]" />
        {/* fx-pop runs on mount, i.e. each open — a small springy scale+rise entrance.
            The wrapper stays transform-positioned; the inner div animates so the two
            transforms don't fight. */}
        {/* Phone geometry is a bottom sheet, not a centered card: it sits in the thumb's
            reach, it can be taller (a centered card has to leave room above *and* below,
            which in landscape left almost nothing), and its bottom padding clears the home
            indicator. From `sm` up it's the centered modal it has always been. */}
        <RDialog.Content
          className={`fixed inset-x-0 bottom-0 z-[1001] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
            ${xwide
              ? 'sm:w-[min(1000px,calc(100vw-2rem))]'
              : wide
                ? 'sm:w-[min(720px,calc(100vw-2rem))]'
                : 'sm:w-[min(440px,calc(100vw-2rem))]'}`}
        >
          <div className="fx-sheet max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-[26px] border border-border bg-surface p-6 pb-[calc(1.5rem+var(--safe-bottom))] shadow-[var(--shadow-pop)] focus:outline-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-[26px] sm:p-7 sm:pb-7">
          {/* Sheet grab handle — the affordance that says this panel is dismissible. */}
          <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-fill-hover sm:hidden" aria-hidden />
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="section-kicker mb-1.5">KCCP Attendance</div>
              <RDialog.Title className="font-display text-[22px] font-bold leading-tight tracking-[-0.02em] text-text">{title}</RDialog.Title>
            </div>
            <RDialog.Close
              aria-label="Close"
              className="-mr-1.5 -mt-0.5 grid min-h-9 min-w-9 place-items-center rounded-full bg-fill text-muted transition-[background-color,color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-fill-hover hover:text-text active:scale-90"
            >
              <X size={18} strokeWidth={2.25} aria-hidden />
            </RDialog.Close>
          </div>
          {children}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
