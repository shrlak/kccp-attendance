import { Navigate, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { KioskGate } from './KioskGate'
import { KioskView } from './KioskView'

// The /kiosk route, reachable straight from the landing page. Unauthenticated visitors
// get the kiosk password gate, which only unlocks with the welcoming-team password
// (role 'welcoming'). A session holding any other admin role is sent to the admin
// panel instead — admins launch the kiosk from there (AdminApp's 키오스크 button),
// and the read-only pastor role can't run a kiosk at all. 나가기 exits in one tap —
// no password, no confirm — so it signs the kiosk session out and returns to the
// landing page rather than exposing the welcoming dashboard on the shared tablet.
export function KioskShell() {
  const status = useAdminAuth((s) => s.status)
  const role = useAdminAuth((s) => s.identity?.role)
  const signOut = useAdminAuth((s) => s.signOut)
  const navigate = useNavigate()
  if (status !== 'authed') return <KioskGate />
  if (role !== 'welcoming') return <Navigate to="/admin" replace />
  return (
    <KioskView
      onExit={() => {
        signOut()
        navigate('/')
      }}
    />
  )
}
