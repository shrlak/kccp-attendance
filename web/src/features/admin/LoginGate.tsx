import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { KccpMark } from '../checkin/KccpMark'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

// Admin gate: master password on this (personal) device. No email/accounts.
export function LoginGate() {
  const { t } = useTranslation()
  const status = useAdminAuth((s) => s.status)
  const verify = useAdminAuth((s) => s.verify)
  const [pw, setPw] = useState('')
  const busy = status === 'verifying'

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-xs text-center">
        <KccpMark size={56} className="mx-auto mb-5 text-primary" />
        <h1 className="mb-1 font-display text-2xl font-semibold text-text">{t('admin.title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('admin.subtitle')}</p>
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
        {status === 'error' && <p className="mt-2 text-xs text-danger">{t('admin.wrongPassword')}</p>}
        <Button onClick={() => void verify(pw)} disabled={busy || !pw} className="mt-4 w-full">
          {busy ? t('common.loading') : t('admin.unlock')}
        </Button>
      </div>
    </main>
  )
}
