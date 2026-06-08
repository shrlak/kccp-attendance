import { useAdminAuth } from '../../stores/useAdminAuth'
import { LoginGate } from './LoginGate'
import { AdminApp } from './AdminApp'

export function AdminShell() {
  const status = useAdminAuth((s) => s.status)
  return status === 'authed' ? <AdminApp /> : <LoginGate />
}
