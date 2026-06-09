import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/api', () => ({
  adminVerify: vi.fn(),
  adminVerifyGoogle: vi.fn(),
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

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('useAdminAuth', () => {
  it('authes and persists the password on a successful verify', async () => {
    const { adminVerify, setAdminPassword } = await import('../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
      role: 'leader', group: '청년부', subgroup: '건영동산', ministry: 'KM',
    })
    const { useAdminAuth } = await import('./useAdminAuth')
    const ok = await useAdminAuth.getState().verify('kccpwelcome')
    expect(ok).toBe(true)
    expect(useAdminAuth.getState().status).toBe('authed')
    expect(useAdminAuth.getState().identity?.role).toBe('leader')
    expect(setAdminPassword).toHaveBeenCalledWith('kccpwelcome')
    expect(sessionStorage.getItem('kccp-admin-pw')).toBe('kccpwelcome')
  })

  it('errors and clears the password on a rejected verify', async () => {
    const { adminVerify } = await import('../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not authorized'))
    const { useAdminAuth } = await import('./useAdminAuth')
    const ok = await useAdminAuth.getState().verify('wrong')
    expect(ok).toBe(false)
    expect(useAdminAuth.getState().status).toBe('error')
    expect(sessionStorage.getItem('kccp-admin-pw')).toBeNull()
  })

  it('signOut clears state', async () => {
    const { useAdminAuth } = await import('./useAdminAuth')
    useAdminAuth.getState().signOut()
    expect(useAdminAuth.getState().status).toBe('idle')
    expect(useAdminAuth.getState().identity).toBeNull()
  })
})
