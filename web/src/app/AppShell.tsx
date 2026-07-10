import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'

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
        <div className="fixed top-0 inset-x-0 z-[200] bg-warning text-[#3a2a08] text-center text-xs font-semibold py-1.5
                        pt-[calc(0.375rem+env(safe-area-inset-top))]">
          오프라인 모드
        </div>
      )}
      <Outlet />
    </ToastProvider>
  )
}
