import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { kioskNewMember, type NewMemberFields } from '../../lib/api'

const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']

const EMPTY = {
  name: '',
  group: '대학부',
  subgroup: '',
  gender: '',
  phone: '',
  kakaoId: '',
  birthDate: '',
  baptismStatus: '',
  schoolOrWork: '',
  faithDuration: '',
  pastoralVisitRequested: false,
}

// 새가족 (new-family) registration from the kiosk: collects name + group + 동산 + the
// extended profile fields, then creates the member/device and checks them in for today.
export function KioskNewMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ ...EMPTY })
  const [busy, setBusy] = useState(false)

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setF((prev) => ({ ...prev, [key]: value }))
  }
  function close() {
    setF({ ...EMPTY })
    setBusy(false)
    onClose()
  }

  async function submit() {
    if (!f.name.trim() || !f.group) {
      toast({ title: t('kiosk.newMember.nameRequired'), tone: 'warn' })
      return
    }
    setBusy(true)
    try {
      const payload: NewMemberFields = {
        name: f.name.trim(),
        group: f.group,
        subgroup: f.subgroup.trim(),
        gender: f.gender,
        phone: f.phone.trim(),
        kakaoId: f.kakaoId.trim(),
        birthDate: f.birthDate || null,
        baptismStatus: f.baptismStatus,
        schoolOrWork: f.schoolOrWork.trim(),
        faithDuration: f.faithDuration.trim(),
        // 등록일자 is stamped server-side with the add date — attendance percentages
        // count from it, so it is not user-editable here.
        pastoralVisitRequested: f.pastoralVisitRequested,
      }
      await kioskNewMember(payload)
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast({ title: t('kiosk.newMember.done', { name: payload.name }), tone: 'ok' })
      close()
    } catch (e) {
      // Surface the real reason (auth/network/server message) instead of a generic error,
      // so a failing kiosk is diagnosable rather than silently "not working".
      toast({ title: (e as Error)?.message || t('common.error'), tone: 'err' })
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('kiosk.newMember.title')}>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        <Field label={t('kiosk.newMember.name')}>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus autoComplete="off" />
        </Field>
        <Field label={t('kiosk.newMember.group')}>
          <Select value={f.group} onChange={(e) => set('group', e.target.value)}>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('kiosk.newMember.subgroup')}>
          <Input value={f.subgroup} onChange={(e) => set('subgroup', e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('kiosk.newMember.gender')}>
          <Input value={f.gender} onChange={(e) => set('gender', e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('kiosk.newMember.phone')}>
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" inputMode="tel" />
        </Field>
        <Field label={t('kiosk.newMember.kakaoId')}>
          <Input value={f.kakaoId} onChange={(e) => set('kakaoId', e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('kiosk.newMember.birthDate')}>
          <Input type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
        </Field>
        <Field label={t('kiosk.newMember.baptism')}>
          <Input value={f.baptismStatus} onChange={(e) => set('baptismStatus', e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('kiosk.newMember.school')}>
          <Input value={f.schoolOrWork} onChange={(e) => set('schoolOrWork', e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('kiosk.newMember.faith')}>
          <Input value={f.faithDuration} onChange={(e) => set('faithDuration', e.target.value)} autoComplete="off" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={f.pastoralVisitRequested}
            onChange={(e) => set('pastoralVisitRequested', e.target.checked)}
            className="h-4 w-4"
          />
          {t('kiosk.newMember.pastoralVisit')}
        </label>
      </div>
      <Button onClick={() => void submit()} disabled={busy} className="mt-4 w-full">
        {busy ? t('common.loading') : t('kiosk.newMember.submit')}
      </Button>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-subtle">{label}</span>
      {children}
    </label>
  )
}
