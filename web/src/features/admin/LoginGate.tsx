import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { AccessShell } from '../../components/layout/AccessShell'

export function LoginGate() {
  const { t } = useTranslation()
  const status = useAdminAuth((s) => s.status)
  const verify = useAdminAuth((s) => s.verify)
  const signInWithGoogle = useAdminAuth((s) => s.signInWithGoogle)
  const [pw, setPw] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const busy = status === 'verifying'

  return (
    <AccessShell eyebrow={t('access.adminEyebrow')} title={t('admin.title')} subtitle={t('admin.subtitle')}>
      <div>
        <Button onClick={() => void signInWithGoogle()} disabled={busy} className="w-full">
          {busy && !showPassword ? t('common.loading') : t('admin.signInWithGoogle')}
        </Button>

        {status === 'error' && (
          <p className="mt-2 text-xs text-danger">{t('admin.googleError')}</p>
        )}

        <button
          type="button"
          className="mt-6 text-xs font-semibold text-muted underline underline-offset-4 hover:text-text"
          onClick={() => setShowPassword((v) => !v)}
        >
          {t('admin.usePassword')}
        </button>

        {showPassword && (
          <div className="mt-4 border-l-2 border-border pl-4">
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
    </AccessShell>
  )
}
