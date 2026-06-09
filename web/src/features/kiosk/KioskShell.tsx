import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { LoginGate } from '../admin/LoginGate'
import { KioskView } from './KioskView'

// The /kiosk route: the kiosk runs on a verified admin device, so gate on admin auth
// (reusing the admin login). Exiting returns to the admin panel.
export function KioskShell() {
  const status = useAdminAuth((s) => s.status)
  const navigate = useNavigate()
  if (status !== 'authed') return <LoginGate />
  return <KioskView onExit={() => navigate('/admin')} />
}
