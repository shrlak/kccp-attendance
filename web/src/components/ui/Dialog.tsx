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
        <RDialog.Overlay className="fixed inset-0 z-[1000] bg-[#07100c]/65 backdrop-blur-[2px]" />
        <RDialog.Content
          className={`fixed left-1/2 top-1/2 z-[1001] -translate-x-1/2 -translate-y-1/2
            max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-2xl focus:outline-none sm:p-7
            ${wide ? 'w-[min(720px,calc(100vw-2rem))]' : 'w-[min(420px,calc(100vw-2rem))]'}`}
        >
          <div className="mb-5 flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="section-kicker mb-1">KCCP · Attendance</div>
              <RDialog.Title className="font-display text-lg font-bold tracking-tight text-text">{title}</RDialog.Title>
            </div>
            <RDialog.Close aria-label="Close" className="-mr-2 flex min-h-10 min-w-10 items-center justify-center rounded-sm text-subtle hover:bg-surface-alt hover:text-text">
              <X size={20} strokeWidth={2} aria-hidden />
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
