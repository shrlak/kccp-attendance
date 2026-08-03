import { Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { CheckinScreen } from '../features/checkin/CheckinScreen'
import { AdminShell } from '../features/admin/AdminShell'
import { KioskShell } from '../features/kiosk/KioskShell'
import { NotFound } from './NotFound'

// A reload stays where it was — the URL is the screen, and the admin session (sessionStorage
// password / Supabase's own Google session) survives it, so reloading the admin panel or the
// kiosk lands back on the same screen rather than the landing page. The panel's own tab is
// remembered alongside it (see adminTab.ts). Signing out is what goes home.
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<CheckinScreen />} />
        <Route path="/admin" element={<AdminShell />} />
        <Route path="/kiosk" element={<KioskShell />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
