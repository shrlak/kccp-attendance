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
}

export function Dialog({ open, onOpenChange, title, children, wide }: DialogProps) {
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
        <RDialog.Content
          className={`fixed left-1/2 top-1/2 z-[1001] -translate-x-1/2 -translate-y-1/2
            ${wide ? 'w-[min(720px,calc(100vw-2rem))]' : 'w-[min(440px,calc(100vw-2rem))]'}`}
        >
          <div className="fx-pop max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[26px] border border-border bg-surface p-6 shadow-[var(--shadow-pop)] focus:outline-none sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
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
