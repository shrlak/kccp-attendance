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
        <RDialog.Overlay className="fixed inset-0 bg-black/50 z-[1000]" />
        <RDialog.Content
          className={`fixed left-1/2 top-1/2 z-[1001] -translate-x-1/2 -translate-y-1/2
            bg-surface border border-border rounded-xl p-7 focus:outline-none
            ${wide ? 'w-[min(720px,calc(100vw-2rem))]' : 'w-[min(420px,calc(100vw-2rem))]'}`}
        >
          <div className="flex items-center justify-between mb-3">
            <RDialog.Title className="font-display text-lg font-semibold text-text">{title}</RDialog.Title>
            <RDialog.Close aria-label="Close" className="text-subtle hover:text-text min-h-11 min-w-11 -mr-2 flex items-center justify-center">
              <X size={20} strokeWidth={2} aria-hidden />
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
