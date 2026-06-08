import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { selfRegister, type SelfRegisterResponse } from '../../lib/api'

// The four 부서 (departments). Stable values; the server inherits 동산 from an
// existing same-name member, so 동산 is intentionally not collected here.
const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']

export function SelfRegisterDialog({
  open,
  onOpenChange,
  onRegistered,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onRegistered: (res: SelfRegisterResponse) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!name.trim()) return setErr(t('register.enterName'))
    if (!group) return setErr(t('register.groupPlaceholder'))
    setBusy(true)
    setErr('')
    try {
      const res = await selfRegister(name.trim(), group)
      onOpenChange(false)
      onRegistered(res)
    } catch {
      setErr(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('register.welcome')}>
      <p className="mb-4 text-sm text-muted">{t('register.firstVisit')}</p>
      <div className="flex flex-col gap-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('register.namePlaceholder')}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label={t('register.groupPlaceholder')}>
          <option value="">{t('register.groupPlaceholder')}</option>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        {err && <p className="text-xs text-danger">{err}</p>}
        <Button onClick={() => void submit()} disabled={busy} className="mt-1 w-full">
          {t('register.save')}
        </Button>
      </div>
    </Dialog>
  )
}
