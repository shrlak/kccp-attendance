import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Check } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { guestCheckin } from '../../lib/api'
import { refreshRoster } from '../../lib/live'

// The 부서 a visitor is attending — puts them on that group's 오늘 sheet / 출석부 이미지.
const GUEST_GROUPS = ['대학부', '청년부'] as const

// 방문자 (guest) check-in from the kiosk: name + 부서 → hardened guest endpoint.
export function KioskGuestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)

  function close() {
    setName('')
    setGroup('')
    setBusy(false)
    onClose()
  }

  async function submit() {
    const n = name.trim()
    if (!n || !group || busy) return
    setBusy(true)
    try {
      const res = await guestCheckin(n, group)
      refreshRoster(qc)
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
      <div className="flex flex-col gap-4">
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
        <div>
          <span className="field-label">{t('kiosk.guest.group')}</span>
          <div className="grid grid-cols-2 gap-2.5">
            {GUEST_GROUPS.map((g) => {
              const active = group === g
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setGroup(g)}
                  className={`inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-[background-color,border-color,color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.97] ${
                    active
                      ? 'border-primary bg-primary/10 text-primary shadow-[var(--shadow-sm)]'
                      : 'border-border bg-surface text-text hover:bg-surface-alt'
                  }`}
                >
                  {active && <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />}
                  {g}
                </button>
              )
            })}
          </div>
        </div>
        <Button onClick={() => void submit()} disabled={!name.trim() || !group || busy} className="w-full">
          <Check className="size-4" strokeWidth={2.25} aria-hidden />
          {busy ? t('common.loading') : t('kiosk.guest.submit')}
        </Button>
      </div>
    </Dialog>
  )
}
