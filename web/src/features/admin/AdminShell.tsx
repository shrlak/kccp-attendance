import { useAdminAuth } from '../../stores/useAdminAuth'
import { LoginGate } from './LoginGate'
import { AdminHome } from './AdminHome'

export function AdminShell() {
  const status = useAdminAuth((s) => s.status)
  return status === 'authed' ? <AdminHome /> : <LoginGate />
}
