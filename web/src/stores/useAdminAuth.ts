import { create } from 'zustand'
import { adminVerify, adminVerifyGoogle, setAdminPassword, setAdminToken, type AdminIdentity } from '../lib/api'
import { supabase } from '../lib/supabase'

const PW_KEY = 'kccp-admin-pw'
// Where the Google OAuth callback should land. Set before the redirect (the kiosk gate
// passes '/kiosk'), read once when the callback verifies; anything else means /admin.
const RETURN_KEY = 'kccp-oauth-return'

function readPw(): string | null {
  try { return sessionStorage.getItem(PW_KEY) } catch { return null }
}
function writePw(pw: string | null): void {
  try {
    if (pw) sessionStorage.setItem(PW_KEY, pw)
    else sessionStorage.removeItem(PW_KEY)
  } catch { /* non-fatal */ }
}

export type AdminStatus = 'idle' | 'verifying' | 'authed' | 'error'

interface AdminAuthState {
  status: AdminStatus
  identity: AdminIdentity | null
  verify: (password: string) => Promise<boolean>
  signInWithGoogle: (returnTo?: '/kiosk') => Promise<void>
  signOut: () => void
}

export const useAdminAuth = create<AdminAuthState>((set) => ({
  status: 'idle',
  identity: null,

  // Break-glass: device + master password (unchanged).
  verify: async (password) => {
    set({ status: 'verifying' })
    try {
      setAdminPassword(password)
      const identity = await adminVerify(password)
      writePw(password)
      set({ status: 'authed', identity })
      return true
    } catch {
      setAdminPassword(null)
      writePw(null)
      set({ status: 'error', identity: null })
      return false
    }
  },

  // Google sign-in: triggers the OAuth redirect; onAuthStateChange handles the callback,
  // which lands on `returnTo` ('/kiosk' from the kiosk gate) or /admin by default.
  signInWithGoogle: async (returnTo) => {
    set({ status: 'verifying' })
    try {
      if (returnTo) sessionStorage.setItem(RETURN_KEY, returnTo)
      else sessionStorage.removeItem(RETURN_KEY)
    } catch { /* non-fatal */ }
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Redirect to the site root (a real file) so GitHub Pages serves it directly — no
      // dependence on the 404.html SPA fallback. The auth handler routes to /admin once
      // the session verifies.
      options: { redirectTo: 'https://shrlak.github.io/kccp-attendance/' },
    })
    // Page redirects away — control does not return here.
  },

  signOut: () => {
    setAdminPassword(null)
    setAdminToken(null)
    writePw(null)
    void supabase.auth.signOut()
    set({ status: 'idle', identity: null })
  },
}))

// Whether this page load is the OAuth redirect landing. Supabase appends `?code=` (PKCE)
// or a `#access_token=` hash (implicit) to the redirect URL. Captured at module load —
// before supabase-js strips it — so we can route to /admin once the session verifies,
// regardless of whether the callback surfaces as INITIAL_SESSION or SIGNED_IN (the event
// differs across supabase-js versions).
const isOAuthCallback =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('code') ||
    window.location.hash.includes('access_token'))

// Route to the post-login page without a full reload (the OAuth redirect lands at the
// site root). Honors the stored return path — '/kiosk' when the sign-in started at the
// kiosk gate, /admin otherwise. React Router listens for popstate, so dispatching one
// makes it render the new path.
function navigateAfterOAuth(): void {
  if (typeof window === 'undefined') return
  let path = '/admin'
  try {
    if (sessionStorage.getItem(RETURN_KEY) === '/kiosk') path = '/kiosk'
    sessionStorage.removeItem(RETURN_KEY)
  } catch { /* non-fatal */ }
  const full = `/kccp-attendance${path}`
  if (window.location.pathname.startsWith(full)) return
  window.history.pushState({}, '', full)
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
}

// Verify a Google session with the edge function. On success, reflect it in the store and
// — when this load is the fresh OAuth callback — route to the return path (/admin, or
// /kiosk when the sign-in started at the kiosk gate) so the user lands where they meant
// to go instead of the public landing page. Returns false if the session isn't an
// authorized admin (caller decides how to surface that).
async function verifyGoogleSession(accessToken: string): Promise<boolean> {
  useAdminAuth.setState({ status: 'verifying' })
  try {
    setAdminToken(accessToken)
    const identity = await adminVerifyGoogle()
    useAdminAuth.setState({ status: 'authed', identity })
    if (isOAuthCallback) navigateAfterOAuth()
    return true
  } catch {
    setAdminToken(null)
    return false
  }
}

// Handle Supabase auth state. An OAuth callback may arrive as INITIAL_SESSION or SIGNED_IN
// depending on the supabase-js version, so both verify + route through the same helper.
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'INITIAL_SESSION') {
    if (session?.access_token) {
      // Active Google session — verify it; if it's not an admin, fall back to a saved
      // break-glass password rather than showing an error on a passive page load.
      const ok = await verifyGoogleSession(session.access_token)
      if (!ok) {
        useAdminAuth.setState({ status: 'idle', identity: null })
        const stored = readPw()
        if (stored) void useAdminAuth.getState().verify(stored)
      }
    } else {
      // No Google session — try a saved break-glass password.
      const stored = readPw()
      if (stored) void useAdminAuth.getState().verify(stored)
    }
  } else if (event === 'SIGNED_IN' && session?.access_token) {
    if (useAdminAuth.getState().status === 'authed') return
    // Active sign-in — surface an error if this Google account isn't an authorized admin.
    const ok = await verifyGoogleSession(session.access_token)
    if (!ok) useAdminAuth.setState({ status: 'error', identity: null })
  } else if (event === 'SIGNED_OUT') {
    setAdminToken(null)
  }
})
