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
    <main className="grid min-h-dvh place-items-center bg-canvas">
      <span className="fx-pulse grid size-16 place-items-center rounded-[22px] border border-border bg-surface shadow-[var(--shadow)]">
        <KccpMark size={36} className="text-primary" />
      </span>
    </main>
  )
  return <LoginGate />
}
