import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { KccpMark } from '../checkin/KccpMark'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'

// Password gate for /kiosk reached from the public landing page: a single password
// field, no Google sign-in. The kiosk only opens for the welcoming-team password
// (server-verified role 'welcoming') — KioskShell routes any other valid admin
// password to the admin panel instead, where the 키오스크 button still works.
export function KioskGate() {
  const { t } = useTranslation()
  const verify = useAdminAuth((s) => s.verify)
  const status = useAdminAuth((s) => s.status)
  const [pw, setPw] = useState('')
  const busy = status === 'verifying'

  async function submit() {
    if (!pw || busy) return
    await verify(pw)
    // On success KioskShell re-renders into the kiosk (welcoming) or the admin
    // panel (any other role); on failure the store's error status shows below.
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="absolute right-4 top-4 flex items-center gap-1 pt-[env(safe-area-inset-top)]">
        <ThemeLangToggle />
      </div>
      <div className="w-full max-w-xs text-center">
        <KccpMark size={56} className="mx-auto mb-5 text-primary" />
        <h1 className="mb-1 font-display text-2xl font-semibold text-text">{t('kiosk.gate.title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('kiosk.gate.subtitle')}</p>

        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t('kiosk.gate.passwordPlaceholder')}
          aria-label={t('kiosk.gate.passwordPlaceholder')}
          autoFocus
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pw) void submit()
          }}
        />
        {status === 'error' && (
          <p className="mt-2 text-xs text-danger">{t('kiosk.gate.wrong')}</p>
        )}
        <Button onClick={() => void submit()} disabled={busy || !pw} className="mt-3 w-full">
          {busy ? t('common.loading') : t('kiosk.gate.submit')}
        </Button>
      </div>
    </main>
  )
}
