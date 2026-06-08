import { create } from 'zustand'
import { adminVerify, setAdminPassword, type AdminIdentity } from '../lib/api'

// The master password is held in sessionStorage (cleared when the tab closes), and
// mirrored into the api module so admin requests carry X-Admin-Password.
const PW_KEY = 'kccp-admin-pw'

function readPw(): string | null {
  try {
    return sessionStorage.getItem(PW_KEY)
  } catch {
    return null
  }
}
function writePw(pw: string | null): void {
  try {
    if (pw) sessionStorage.setItem(PW_KEY, pw)
    else sessionStorage.removeItem(PW_KEY)
  } catch {
    /* non-fatal */
  }
}

export type AdminStatus = 'idle' | 'verifying' | 'authed' | 'error'

interface AdminAuthState {
  status: AdminStatus
  identity: AdminIdentity | null
  verify: (password: string) => Promise<boolean>
  signOut: () => void
}

export const useAdminAuth = create<AdminAuthState>((set) => ({
  status: 'idle',
  identity: null,
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
  signOut: () => {
    setAdminPassword(null)
    writePw(null)
    set({ status: 'idle', identity: null })
  },
}))

// Re-verify a password persisted from earlier in the session (survives reloads).
const stored = readPw()
if (stored) void useAdminAuth.getState().verify(stored)
