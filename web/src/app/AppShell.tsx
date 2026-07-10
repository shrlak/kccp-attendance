import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'

export function AppShell() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    // Check connectivity via a lightweight HEAD request with short timeout
    const checkConnectivity = async () => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        // Ping GitHub (widely available, CORS-friendly for HEAD)
        await fetch('https://github.com', { method: 'HEAD', signal: controller.signal })
        clearTimeout(timeout)
        setOffline(false)
      } catch {
        setOffline(true)
      }
    }

    // Run initial check
    checkConnectivity()

    // Listen for native online/offline events as a faster signal
    const onOnline = () => {
      setOffline(false)
    }
    const onOffline = () => {
      setOffline(true)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    // Periodic check every 30s when offline to detect reconnection
    const intervalId = setInterval(checkConnectivity, 30000)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(intervalId)
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
