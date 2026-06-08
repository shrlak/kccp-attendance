import * as RDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}

export function Dialog({ open, onOpenChange, title, children }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <RDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))]
          -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-xl p-7
          focus:outline-none">
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
