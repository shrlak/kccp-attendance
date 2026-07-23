import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'
import { WifiOff } from '../components/ui/Icon'

export function AppShell() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    // Listen for native online/offline events
    const onOnline = () => {
      setOffline(false)
    }
    const onOffline = () => {
      setOffline(true)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])
  return (
    <ToastProvider>
      {offline && (
        <div className="material-bar fx-slide-up fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 border-b
                        py-2 text-center text-xs font-semibold text-warning pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <WifiOff className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          네트워크 연결이 없습니다 · 오프라인 모드
        </div>
      )}
      <Outlet />
    </ToastProvider>
  )
}
