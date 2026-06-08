import { Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { CheckinScreen } from '../features/checkin/CheckinScreen'
import { AdminShell } from '../features/admin/AdminShell'
import { KioskShell } from '../features/kiosk/KioskShell'
import { NotFound } from './NotFound'

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
