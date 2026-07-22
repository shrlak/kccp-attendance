import * as RToast from '@radix-ui/react-toast'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { CheckCircle, AlertTriangle } from './Icon'

type Tone = 'ok' | 'warn' | 'err'
interface ToastState { title: string; tone: Tone }
const ToastCtx = createContext<(t: ToastState) => void>(() => {})
// eslint-disable-next-line react-refresh/only-export-components -- the toast hook lives with its provider
export const useToast = () => useContext(ToastCtx)

const toneColor: Record<Tone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  err: 'text-danger',
}
const ToneIcon: Record<Tone, typeof CheckCircle> = {
  ok: CheckCircle,
  warn: AlertTriangle,
  err: AlertTriangle,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [open, setOpen] = useState(false)
  const show = (t: ToastState) => { setToast(t); setOpen(false); requestAnimationFrame(() => setOpen(true)) }
  const Icon = toast ? ToneIcon[toast.tone] : CheckCircle
  return (
    <ToastCtx.Provider value={show}>
      <RToast.Provider duration={4000} swipeDirection="down">
        {children}
        {toast && (
          <RToast.Root open={open} onOpenChange={setOpen}
            className="material-bar fx-slide-up flex items-center gap-2.5 rounded-full border px-4 py-3 text-sm font-semibold text-text shadow-[var(--shadow-lg)]">
            <Icon className={`size-5 shrink-0 ${toneColor[toast.tone]}`} aria-hidden />
            <RToast.Title>{toast.title}</RToast.Title>
          </RToast.Root>
        )}
        <RToast.Viewport className="fixed bottom-6 left-1/2 z-[1100] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2 outline-none" />
      </RToast.Provider>
    </ToastCtx.Provider>
  )
}
