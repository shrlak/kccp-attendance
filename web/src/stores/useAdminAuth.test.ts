import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/api', () => ({
  adminVerify: vi.fn(),
  adminVerifyGoogle: vi.fn(),
  getLoginPosition: vi.fn().mockResolvedValue(null),
  setAdminPassword: vi.fn(),
  setAdminToken: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}))

const PW_KEY = 'kccp-admin-pw'
const ACTIVITY_KEY = 'kccp-admin-activity'
const TWO_HOURS_MS = 2 * 60 * 60 * 1000

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('useAdminAuth', () => {
  it('authes, persists the password, and stamps activity on a successful verify', async () => {
    const { adminVerify, setAdminPassword } = await import('../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
      role: 'leader', group: '청년부', subgroup: '건영동산', ministry: 'KM',
    })
    const { useAdminAuth } = await import('./useAdminAuth')
    const ok = await useAdminAuth.getState().verify('kccpwelcome')
    expect(ok).toBe(true)
    expect(useAdminAuth.getState().status).toBe('authed')
    expect(useAdminAuth.getState().method).toBe('password')
    expect(useAdminAuth.getState().identity?.role).toBe('leader')
    expect(setAdminPassword).toHaveBeenCalledWith('kccpwelcome')
    expect(sessionStorage.getItem(PW_KEY)).toBe('kccpwelcome')
    expect(Number(sessionStorage.getItem(ACTIVITY_KEY))).toBeCloseTo(Date.now(), -2)
  })

  it('errors and clears the password + activity on a rejected verify', async () => {
    const { adminVerify } = await import('../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not authorized'))
    const { useAdminAuth } = await import('./useAdminAuth')
    const ok = await useAdminAuth.getState().verify('wrong')
    expect(ok).toBe(false)
    expect(useAdminAuth.getState().status).toBe('error')
    expect(useAdminAuth.getState().method).toBeNull()
    expect(sessionStorage.getItem(PW_KEY)).toBeNull()
    expect(sessionStorage.getItem(ACTIVITY_KEY)).toBeNull()
  })

  it('signOut clears state, password, and activity', async () => {
    const { adminVerify } = await import('../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
      role: 'leader', group: '청년부', subgroup: '건영동산', ministry: 'KM',
    })
    const { useAdminAuth } = await import('./useAdminAuth')
    await useAdminAuth.getState().verify('kccpwelcome')
    useAdminAuth.getState().signOut()
    expect(useAdminAuth.getState().status).toBe('idle')
    expect(useAdminAuth.getState().identity).toBeNull()
    expect(useAdminAuth.getState().method).toBeNull()
    expect(sessionStorage.getItem(PW_KEY)).toBeNull()
    expect(sessionStorage.getItem(ACTIVITY_KEY)).toBeNull()
  })

  it('drops a saved password on reload once the tab has been idle past 2h — no auto re-auth', async () => {
    sessionStorage.setItem(PW_KEY, 'kccpadmin')
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now() - TWO_HOURS_MS - 1000))
    const { adminVerify } = await import('../lib/api')
    const { supabase } = await import('../lib/supabase')
    const { useAdminAuth } = await import('./useAdminAuth')

    const onAuthStateChange = vi.mocked(supabase.auth.onAuthStateChange)
    const callback = onAuthStateChange.mock.calls[0][0]
    await callback('INITIAL_SESSION', null)

    expect(adminVerify).not.toHaveBeenCalled()
    expect(useAdminAuth.getState().status).toBe('idle')
    expect(sessionStorage.getItem(PW_KEY)).toBeNull()
    expect(sessionStorage.getItem(ACTIVITY_KEY)).toBeNull()
  })

  it('rehydrates a saved password on reload when activity is within the 2h window', async () => {
    sessionStorage.setItem(PW_KEY, 'kccpadmin')
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now() - 1000))
    const { adminVerify } = await import('../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
      role: 'super_admin', group: '', subgroup: '', ministry: '',
    })
    const { supabase } = await import('../lib/supabase')
    const { useAdminAuth } = await import('./useAdminAuth')

    const onAuthStateChange = vi.mocked(supabase.auth.onAuthStateChange)
    const callback = onAuthStateChange.mock.calls[0][0]
    await callback('INITIAL_SESSION', null)
    await vi.waitFor(() => expect(useAdminAuth.getState().status).toBe('authed'))

    expect(adminVerify).toHaveBeenCalledWith('kccpadmin', null)
    expect(useAdminAuth.getState().method).toBe('password')
  })
})
