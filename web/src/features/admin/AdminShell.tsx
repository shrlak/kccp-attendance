import { useAdminAuth } from '../../stores/useAdminAuth'
import { LoginGate } from './LoginGate'
import { AdminApp } from './AdminApp'
import { KccpMark } from '../checkin/KccpMark'

export function AdminShell() {
  const status = useAdminAuth((s) => s.status)
  if (status === 'authed') return <AdminApp />
  // Show a neutral loading screen during OAuth callback processing so the login form
  // doesn't flash briefly while the session is being verified.
  if (status === 'verifying') return (
    <main className="grid min-h-dvh place-items-center">
      <KccpMark size={40} className="animate-pulse text-primary" />
    </main>
  )
  return <LoginGate />
}
