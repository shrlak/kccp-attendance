import { useEffect } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { CheckinScreen } from '../features/checkin/CheckinScreen'
import { AdminShell } from '../features/admin/AdminShell'
import { KioskShell } from '../features/kiosk/KioskShell'
import { NotFound } from './NotFound'

// On an actual page reload, return to the main landing page (reloading the admin panel
// drops you back home). Detected via the Navigation Timing API so a typed URL / bookmark
// and client-side navigation (clicking 관리자) are unaffected; /kiosk is preserved so a
// kiosk device stays put on reload.
function HomeOnReload() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => {
    const entry = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
    if (entry?.type === 'reload' && pathname !== '/' && pathname !== '/kiosk') nav('/', { replace: true })
    // run once on boot only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export function AppRoutes() {
  return (
    <>
      <HomeOnReload />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<CheckinScreen />} />
          <Route path="/admin" element={<AdminShell />} />
          <Route path="/kiosk" element={<KioskShell />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  )
}
