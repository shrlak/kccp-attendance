import * as RToast from '@radix-ui/react-toast'
import { createContext, useContext, useState, type ReactNode } from 'react'

type Tone = 'ok' | 'warn' | 'err'
interface ToastState { title: string; tone: Tone }
const ToastCtx = createContext<(t: ToastState) => void>(() => {})
// eslint-disable-next-line react-refresh/only-export-components -- the toast hook lives with its provider
export const useToast = () => useContext(ToastCtx)

const toneClass: Record<Tone, string> = {
  ok: 'border-success/40 bg-surface text-success',
  warn: 'border-warning/40 bg-surface text-warning',
  err: 'border-danger/40 bg-surface text-danger',
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
            className={`rounded-md border px-4 py-3 text-sm font-semibold shadow-xl ${toneClass[toast.tone]}`}>
            <RToast.Title>{toast.title}</RToast.Title>
          </RToast.Root>
        )}
        <RToast.Viewport className="fixed bottom-6 left-1/2 z-[1100] flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 outline-none" />
      </RToast.Provider>
    </ToastCtx.Provider>
  )
}
