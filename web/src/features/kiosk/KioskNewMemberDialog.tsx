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
import {
  CARD_TITLE,
  AFFILIATION_CATEGORIES,
  BAPTISM_OPTIONS,
  FAITH_OPTIONS,
  joinAffiliation,
} from '../admin/newFamilyCard'
import { broadcastKioskChange } from './live'

const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']
const GENDERS = ['남', '여'] as const

const EMPTY = {
  name: '',
  group: '대학부',
  subgroup: '',
  gender: '',
  phone: '',
  kakaoId: '',
  birthDate: '',
  baptismStatus: '',
  // 소속 category + the 학교/전공 or 직장 detail — joined into school_or_work on submit.
  affiliationCategory: '',
  schoolOrWork: '',
  faithDuration: '',
  registrationDate: '',
  pastoralVisitRequested: false,
}

// Fresh blank form with 등록일 prefilled to today (Eastern) — computed per open so the
// kiosk doesn't stamp a stale date if it stays up across midnight.
const freshForm = () => ({ ...EMPTY, registrationDate: easternNow().date })

// 새가족 (new-family) registration from the kiosk, mirroring the paper 새가족 등록 카드:
// the same title line, and the card's choose-one fields (성별 남/여, 소속 category,
// 세례 여부, 신앙생활, 목사님 심방 요청 O/X) as tap targets instead of free text — the
// options are the canonical Korean values stored in the DB (see ../admin/newFamilyCard).
// Creates the member/device and checks them in for today.
export function KioskNewMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState(freshForm)
  const [busy, setBusy] = useState(false)

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setF((prev) => ({ ...prev, [key]: value }))
  }
  function close() {
    setF(freshForm())
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
        // 소속 stored as "category · detail" inside school_or_work (no DB column for
        // the category — the 등록 카드 export splits it back out).
        schoolOrWork: joinAffiliation(f.affiliationCategory, f.schoolOrWork),
        faithDuration: f.faithDuration.trim(),
        // 등록일 — operator-editable (prefilled to today); server falls back to today if blank.
        registrationDate: f.registrationDate || null,
        pastoralVisitRequested: f.pastoralVisitRequested,
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
        {/* The paper card's title bar — same text, same grey band. */}
        <p className="rounded-md bg-surface-alt px-2 py-2 text-center font-display text-sm font-semibold text-text">
          {CARD_TITLE}
        </p>

        <Section label={t('kiosk.newMember.sectionPersonal')}>
          <Field label={t('kiosk.newMember.name')}>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus autoComplete="off" />
          </Field>
          <ChoiceField label={t('kiosk.newMember.gender')}>
            <ChoiceRow options={GENDERS} value={f.gender} onChange={(v) => set('gender', v)} />
          </ChoiceField>
          <Field label={t('kiosk.newMember.birthDate')}>
            <Input type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
          </Field>
          <Field label={t('kiosk.newMember.phone')}>
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" inputMode="tel" />
          </Field>
          <Field label={t('kiosk.newMember.kakaoId')}>
            <Input value={f.kakaoId} onChange={(e) => set('kakaoId', e.target.value)} autoComplete="off" />
          </Field>
          <ChoiceField label={t('kiosk.newMember.affiliation')} className="col-span-full">
            <ChoiceRow
              options={AFFILIATION_CATEGORIES}
              value={f.affiliationCategory}
              onChange={(v) => set('affiliationCategory', v)}
            />
          </ChoiceField>
          <Field label={t('kiosk.newMember.school')} className="col-span-full">
            <Input value={f.schoolOrWork} onChange={(e) => set('schoolOrWork', e.target.value)} autoComplete="off" />
          </Field>
        </Section>

        <Section label={t('kiosk.newMember.sectionFaith')}>
          <ChoiceField label={t('kiosk.newMember.baptism')} className="col-span-full">
            <ChoiceRow options={BAPTISM_OPTIONS} value={f.baptismStatus} onChange={(v) => set('baptismStatus', v)} />
          </ChoiceField>
          <ChoiceField label={t('kiosk.newMember.faith')} className="col-span-full">
            <ChoiceRow options={FAITH_OPTIONS} value={f.faithDuration} onChange={(v) => set('faithDuration', v)} />
          </ChoiceField>
          <ChoiceField label={t('kiosk.newMember.pastoralVisit')} className="col-span-2 sm:col-span-1">
            <ChoiceRow
              options={['O', 'X'] as const}
              value={f.pastoralVisitRequested ? 'O' : 'X'}
              onChange={(v) => set('pastoralVisitRequested', v === 'O')}
              allowClear={false}
            />
          </ChoiceField>
        </Section>

        <Section label={t('kiosk.newMember.sectionChurch')}>
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
          <Field label={t('kiosk.newMember.registrationDate')}>
            <Input type="date" value={f.registrationDate} onChange={(e) => set('registrationDate', e.target.value)} />
          </Field>
        </Section>
      </div>
      <Button onClick={() => void submit()} disabled={busy} className="mt-4 w-full">
        {busy ? t('common.loading') : t('kiosk.newMember.submit')}
      </Button>
    </Dialog>
  )
}

// A bordered card section with its caption sitting on the border, like the ruled
// sections of the paper registration card. Fields flow 2-up on phones, 3-up wider.
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border px-3 pb-3 pt-1">
      <legend className="rounded-sm bg-surface-alt px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </fieldset>
  )
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold text-subtle">{label}</span>
      {children}
    </label>
  )
}

// Like Field but for button groups — a <div>, not a <label>, so tapping the caption
// doesn't "click" the first button.
function ChoiceField({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="mb-1 block text-xs font-semibold text-subtle">{label}</span>
      {children}
    </div>
  )
}

// Single-select tappable chips (the paper card's checkbox rows). Tapping the selected
// chip clears it again unless allowClear is off (O/X always has one side chosen).
// min-h-11 keeps the targets tablet-finger sized.
function ChoiceRow({
  options,
  value,
  onChange,
  allowClear = true,
}: {
  options: readonly string[]
  value: string
  onChange: (v: string) => void
  allowClear?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(value === o ? (allowClear ? '' : o) : o)}
          className={`min-h-11 rounded-md border px-3.5 text-sm transition-colors ${
            value === o
              ? 'border-primary bg-primary/10 font-semibold text-primary'
              : 'border-border bg-surface text-text'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}
