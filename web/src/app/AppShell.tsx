import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'

export function AppShell() {
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return (
    <ToastProvider>
      {offline && (
        <div className="fixed top-0 inset-x-0 z-[200] bg-warning text-[#3a2a08] text-center text-xs font-semibold py-1.5
                        pt-[calc(0.375rem+env(safe-area-inset-top))]">
          오프라인 모드
        </div>
      )}
      <Outlet />
    </ToastProvider>
  )
}
