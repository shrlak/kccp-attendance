import { create } from 'zustand'
import { adminVerify, adminVerifyGoogle, setAdminPassword, setAdminToken, type AdminIdentity } from '../lib/api'
import { supabase } from '../lib/supabase'

const PW_KEY = 'kccp-admin-pw'

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
  signInWithGoogle: () => Promise<void>
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

  // Google sign-in: triggers the OAuth redirect; onAuthStateChange handles the callback.
  signInWithGoogle: async () => {
    set({ status: 'verifying' })
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://shrlak.github.io/kccp-attendance/admin' },
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

// Handle Supabase auth state: INITIAL_SESSION (on load) + SIGNED_IN (OAuth callback).
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'INITIAL_SESSION') {
    if (session?.access_token) {
      // Active Google session — verify it with the edge function.
      useAdminAuth.setState({ status: 'verifying' })
      try {
        setAdminToken(session.access_token)
        const identity = await adminVerifyGoogle()
        useAdminAuth.setState({ status: 'authed', identity })
      } catch {
        setAdminToken(null)
        useAdminAuth.setState({ status: 'idle', identity: null })
        // Fall through: password restore below will still run.
        const stored = readPw()
        if (stored) void useAdminAuth.getState().verify(stored)
      }
    } else {
      // No Google session — try saved break-glass password.
      const stored = readPw()
      if (stored) void useAdminAuth.getState().verify(stored)
    }
  } else if (event === 'SIGNED_IN' && session?.access_token) {
    const store = useAdminAuth.getState()
    if (store.status === 'authed') return
    useAdminAuth.setState({ status: 'verifying' })
    try {
      setAdminToken(session.access_token)
      const identity = await adminVerifyGoogle()
      useAdminAuth.setState({ status: 'authed', identity })
    } catch {
      setAdminToken(null)
      useAdminAuth.setState({ status: 'error', identity: null })
    }
  } else if (event === 'SIGNED_OUT') {
    setAdminToken(null)
  }
})
