import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'

// Exit confirmation for the kiosk — deliberately password-free: the operator just
// confirms. This is safe because leaving the /kiosk route signs the kiosk session
// out and returns to the public landing page (see KioskShell), so exiting never
// exposes an admin surface; re-entering asks for the kiosk password again.
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
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('kiosk.exitModal.title')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('kiosk.exitModal.confirm')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            {t('common.cancel')}
          </Button>
          <Button onClick={onExit} className="flex-1">
            {t('kiosk.exitModal.submit')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
