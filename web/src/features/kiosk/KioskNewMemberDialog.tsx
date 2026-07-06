import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { kioskNewMember, type NewMemberFields } from '../../lib/api'
import { easternNow } from '../../lib/checkinWindow'
import { NewFamilyCardForm } from '../admin/NewFamilyCardForm'
import { blankCardForm, joinAffiliation, type CardFormValue } from '../admin/newFamilyCard'
import { broadcastKioskChange } from './live'

const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']

// 새가족 (new-family) registration from the kiosk: a blank paper 새가족 등록 카드 to
// fill in directly — type into the card's cells, tap its checkboxes. 등록일 is stamped
// to the day the person is added (the server stamps the same date authoritatively).
// 부서/동산 aren't printed on the paper card, so they sit just below it. Creates the
// member/device and checks them in for today.
export function KioskNewMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  // Fresh blank card per open, 등록일 = today (Eastern) — computed per open so the
  // kiosk doesn't stamp a stale date if it stays up across midnight.
  const [card, setCard] = useState<CardFormValue>(() => blankCardForm(easternNow().date))
  const [group, setGroup] = useState('대학부')
  const [subgroup, setSubgroup] = useState('')
  const [busy, setBusy] = useState(false)

  const patchCard = (patch: Partial<CardFormValue>) => setCard((cur) => ({ ...cur, ...patch }))

  function close() {
    setCard(blankCardForm(easternNow().date))
    setGroup('대학부')
    setSubgroup('')
    setBusy(false)
    onClose()
  }

  async function submit() {
    if (!card.name.trim() || !group) {
      toast({ title: t('kiosk.newMember.nameRequired'), tone: 'warn' })
      return
    }
    setBusy(true)
    try {
      const payload: NewMemberFields = {
        name: card.name.trim(),
        group,
        subgroup: subgroup.trim(),
        gender: card.gender,
        phone: card.phone.trim(),
        kakaoId: card.kakaoId.trim(),
        birthDate: card.birthDate || null,
        baptismStatus: card.baptismStatus,
        // 소속 stored as "category · detail" inside school_or_work (no DB column for
        // the category — the 등록 카드 export splits it back out).
        schoolOrWork: joinAffiliation(card.affiliationCategory, card.affiliationDetail),
        faithDuration: card.faithDuration.trim(),
        // 등록일 = the day they were added (shown stamped on the card; the kiosk
        // endpoint stamps the same date server-side regardless).
        registrationDate: card.registrationDate || null,
        pastoralVisitRequested: card.pastoralVisitRequested,
      }
      await kioskNewMember(payload)
      broadcastKioskChange()
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
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('kiosk.newMember.title')} wide>
      {/* max-h is a safety valve for short/small screens; on the kiosk tablet the whole
          card fits without scrolling. */}
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <NewFamilyCardForm value={card} onChange={patchCard} regDateFixed />

        {/* 부서/동산 — system fields the paper card doesn't carry. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('kiosk.newMember.group')}>
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('kiosk.newMember.subgroup')}>
            <Input value={subgroup} onChange={(e) => setSubgroup(e.target.value)} autoComplete="off" />
          </Field>
        </div>
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
