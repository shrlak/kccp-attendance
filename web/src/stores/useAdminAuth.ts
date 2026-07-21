import { create } from 'zustand'
import { adminVerify, adminVerifyGoogle, getLoginPosition, setAdminPassword, setAdminToken, type AdminIdentity } from '../lib/api'
import { supabase } from '../lib/supabase'

const PW_KEY = 'kccp-admin-pw'
// Where the Google OAuth callback should land. Set before the redirect (the kiosk gate
// passes '/kiosk'), read once when the callback verifies; anything else means /admin.
const RETURN_KEY = 'kccp-oauth-return'
// Last-activity timestamp for password (break-glass) sessions only — Google sessions rely
// on Supabase's own persisted session and are exempt. If a reload finds this stale by more
// than IDLE_TIMEOUT_MS, the saved password is dropped instead of silently re-authing, so
// the tab falls back to the login screen after a long-idle reload.
const ACTIVITY_KEY = 'kccp-admin-activity'
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2h

function readPw(): string | null {
  try { return sessionStorage.getItem(PW_KEY) } catch { return null }
}
function writePw(pw: string | null): void {
  try {
    if (pw) sessionStorage.setItem(PW_KEY, pw)
    else sessionStorage.removeItem(PW_KEY)
  } catch { /* non-fatal */ }
}

function writeActivity(): void {
  try { sessionStorage.setItem(ACTIVITY_KEY, String(Date.now())) } catch { /* non-fatal */ }
}
function clearActivity(): void {
  try { sessionStorage.removeItem(ACTIVITY_KEY) } catch { /* non-fatal */ }
}
function isIdleExpired(): boolean {
  try {
    const raw = sessionStorage.getItem(ACTIVITY_KEY)
    if (!raw) return false
    return Date.now() - Number(raw) > IDLE_TIMEOUT_MS
  } catch { return false }
}

export type AdminStatus = 'idle' | 'verifying' | 'authed' | 'error'
export type AdminAuthMethod = 'password' | 'google' | null

interface AdminAuthState {
  status: AdminStatus
  identity: AdminIdentity | null
  method: AdminAuthMethod
  // captureLocation requests the browser's GPS for the login record — only on an explicit
  // user sign-in. Passive rehydration (silent reload) passes false so reloads never prompt.
  verify: (password: string, captureLocation?: boolean) => Promise<boolean>
  signInWithGoogle: (returnTo?: '/kiosk') => Promise<void>
  signOut: () => void
}

export const useAdminAuth = create<AdminAuthState>((set) => ({
  status: 'idle',
  identity: null,
  method: null,

  // Break-glass: device + master password (unchanged).
  verify: async (password, captureLocation = true) => {
    set({ status: 'verifying' })
    try {
      setAdminPassword(password)
      // Best-effort precise location, only for an explicit sign-in (not a silent reload).
      // Guarded against hanging (see getLoginPosition); resolves null if declined/unsupported.
      const coords = captureLocation ? await getLoginPosition() : null
      const identity = await adminVerify(password, coords)
      writePw(password)
      writeActivity()
      set({ status: 'authed', identity, method: 'password' })
      return true
    } catch {
      setAdminPassword(null)
      writePw(null)
      clearActivity()
      set({ status: 'error', identity: null, method: null })
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
    clearActivity()
    void supabase.auth.signOut()
    set({ status: 'idle', identity: null, method: null })
  },
}))

// Keep the password-session activity timestamp warm while the tab is actually in use, so
// the idle clock measures inactivity rather than just time-since-login. Google sessions
// don't track this — they're exempt from the idle re-login requirement. Throttled so a
// burst of interaction doesn't hammer sessionStorage.
let lastActivityWrite = 0
function bumpActivity(): void {
  if (useAdminAuth.getState().method !== 'password') return
  const now = Date.now()
  if (now - lastActivityWrite < 60_000) return
  lastActivityWrite = now
  writeActivity()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', bumpActivity, { passive: true })
  window.addEventListener('keydown', bumpActivity, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') bumpActivity()
  })
}

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
async function verifyGoogleSession(accessToken: string, captureLocation: boolean): Promise<boolean> {
  useAdminAuth.setState({ status: 'verifying' })
  try {
    setAdminToken(accessToken)
    // Best-effort precise location, only on a fresh sign-in (not a passive session restore
    // on every reload). Guarded against hanging; resolves null if declined/unsupported.
    const coords = captureLocation ? await getLoginPosition() : null
    const identity = await adminVerifyGoogle(coords)
    useAdminAuth.setState({ status: 'authed', identity, method: 'google' })
    if (isOAuthCallback) navigateAfterOAuth()
    return true
  } catch {
    setAdminToken(null)
    return false
  }
}

// A saved break-glass password is only worth rehydrating if the tab hasn't been idle past
// the timeout — otherwise drop it so the reload lands on the login screen instead of
// silently re-authing a long-stale session.
function rehydratePassword(): void {
  const stored = readPw()
  if (!stored) return
  if (isIdleExpired()) {
    writePw(null)
    clearActivity()
    return
  }
  // Silent reload re-auth — not an explicit sign-in, so don't prompt for location.
  void useAdminAuth.getState().verify(stored, false)
}

// Handle Supabase auth state. An OAuth callback may arrive as INITIAL_SESSION or SIGNED_IN
// depending on the supabase-js version, so both verify + route through the same helper.
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'INITIAL_SESSION') {
    if (session?.access_token) {
      // Active Google session — verify it; if it's not an admin, fall back to a saved
      // break-glass password rather than showing an error on a passive page load. Capture
      // location only when this load is the fresh OAuth callback (a real sign-in), not a
      // passive session restore on an ordinary reload.
      const ok = await verifyGoogleSession(session.access_token, isOAuthCallback)
      if (!ok) {
        useAdminAuth.setState({ status: 'idle', identity: null, method: null })
        rehydratePassword()
      }
    } else {
      // No Google session — try a saved break-glass password.
      rehydratePassword()
    }
  } else if (event === 'SIGNED_IN' && session?.access_token) {
    if (useAdminAuth.getState().status === 'authed') return
    // Active sign-in — surface an error if this Google account isn't an authorized admin.
    // This is an explicit login, so capture location.
    const ok = await verifyGoogleSession(session.access_token, true)
    if (!ok) useAdminAuth.setState({ status: 'error', identity: null })
  } else if (event === 'SIGNED_OUT') {
    setAdminToken(null)
  }
})
