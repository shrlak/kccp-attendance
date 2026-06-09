import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { adminVerify } from '../../lib/api'

// Password gate to leave the kiosk (Phase 3.9): re-verify the master password against
// this (already-admin) device, then hand control back to the admin panel via onExit.
export function KioskExitDialog({
  open,
  onClose,
  onExit,
}: {
  open: boolean
  onClose: () => void
  onExit: () => void
}) {
  const { t } = useTranslation()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  function close() {
    setPw('')
    setBusy(false)
    setErr(false)
    onClose()
  }

  async function submit() {
    if (!pw || busy) return
    setBusy(true)
    setErr(false)
    try {
      await adminVerify(pw)
      onExit()
    } catch {
      setErr(true)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('kiosk.exitModal.title')}>
      <div className="flex flex-col gap-3">
        <Input
          type="password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value)
            setErr(false)
          }}
          placeholder={t('kiosk.exitModal.passwordPlaceholder')}
          aria-label={t('kiosk.exitModal.passwordPlaceholder')}
          autoFocus
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        {err && <p className="text-xs text-danger">{t('kiosk.exitModal.wrong')}</p>}
        <Button onClick={() => void submit()} disabled={!pw || busy} className="w-full">
          {busy ? t('common.loading') : t('kiosk.exitModal.submit')}
        </Button>
      </div>
    </Dialog>
  )
}
