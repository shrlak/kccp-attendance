import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { guestCheckin } from '../../lib/api'
import { broadcastKioskChange } from './live'

// 방문자 (guest) check-in from the kiosk: name only → hardened guest endpoint.
export function KioskGuestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  function close() {
    setName('')
    setBusy(false)
    onClose()
  }

  async function submit() {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      const res = await guestCheckin(n)
      broadcastKioskChange()
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast(
        res.status === 'already'
          ? { title: t('kiosk.guest.already', { name: n }), tone: 'warn' }
          : { title: t('kiosk.guest.done', { name: n }), tone: 'ok' },
      )
      close()
    } catch (e) {
      // Surface the real reason (auth/network/server message) instead of a generic error,
      // so a failing kiosk is diagnosable rather than silently "not working".
      toast({ title: (e as Error)?.message || t('common.error'), tone: 'err' })
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('kiosk.guest.title')}>
      <div className="flex flex-col gap-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('kiosk.guest.namePlaceholder')}
          aria-label={t('kiosk.guest.namePlaceholder')}
          autoFocus
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <Button onClick={() => void submit()} disabled={!name.trim() || busy} className="w-full">
          {busy ? t('common.loading') : t('kiosk.guest.submit')}
        </Button>
      </div>
    </Dialog>
  )
}
