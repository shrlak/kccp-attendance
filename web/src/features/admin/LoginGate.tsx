import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { KccpMark } from '../checkin/KccpMark'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

export function LoginGate() {
  const { t } = useTranslation()
  const status = useAdminAuth((s) => s.status)
  const verify = useAdminAuth((s) => s.verify)
  const signInWithGoogle = useAdminAuth((s) => s.signInWithGoogle)
  const [pw, setPw] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const busy = status === 'verifying'

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-xs text-center">
        <KccpMark size={56} className="mx-auto mb-5 text-primary" />
        <h1 className="mb-1 font-display text-2xl font-semibold text-text">{t('admin.title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('admin.subtitle')}</p>

        {/* Primary: Google sign-in */}
        <Button onClick={() => void signInWithGoogle()} disabled={busy} className="w-full">
          {busy && !showPassword ? t('common.loading') : t('admin.signInWithGoogle')}
        </Button>

        {status === 'error' && (
          <p className="mt-2 text-xs text-danger">{t('admin.googleError')}</p>
        )}

        {/* Break-glass: master password (collapsed by default) */}
        <button
          type="button"
          className="mt-5 text-xs text-subtle underline"
          onClick={() => setShowPassword((v) => !v)}
        >
          {t('admin.usePassword')}
        </button>

        {showPassword && (
          <div className="mt-3">
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={t('admin.passwordPlaceholder')}
              aria-label={t('admin.passwordPlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pw) void verify(pw)
              }}
            />
            {status === 'error' && (
              <p className="mt-2 text-xs text-danger">{t('admin.wrongPassword')}</p>
            )}
            <Button
              onClick={() => void verify(pw)}
              disabled={busy || !pw}
              className="mt-3 w-full"
            >
              {busy ? t('common.loading') : t('admin.unlock')}
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}
