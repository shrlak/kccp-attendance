import * as RToast from '@radix-ui/react-toast'
import { createContext, useContext, useState, type ReactNode } from 'react'

type Tone = 'ok' | 'warn' | 'err'
interface ToastState { title: string; tone: Tone }
const ToastCtx = createContext<(t: ToastState) => void>(() => {})
// eslint-disable-next-line react-refresh/only-export-components -- the toast hook lives with its provider
export const useToast = () => useContext(ToastCtx)

const toneClass: Record<Tone, string> = {
  ok: 'bg-success text-white',
  warn: 'bg-warning text-[#3a2a08]',
  err: 'bg-danger text-white',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [open, setOpen] = useState(false)
  const show = (t: ToastState) => { setToast(t); setOpen(false); requestAnimationFrame(() => setOpen(true)) }
  return (
    <ToastCtx.Provider value={show}>
      <RToast.Provider duration={4000} swipeDirection="down">
        {children}
        {toast && (
          <RToast.Root open={open} onOpenChange={setOpen}
            className={`rounded-md px-4 py-2.5 text-sm font-semibold shadow-lg ${toneClass[toast.tone]}`}>
            <RToast.Title>{toast.title}</RToast.Title>
          </RToast.Root>
        )}
        <RToast.Viewport className="fixed left-1/2 -translate-x-1/2 bottom-20 z-[1100] flex flex-col gap-2 outline-none" />
      </RToast.Provider>
    </ToastCtx.Provider>
  )
}
