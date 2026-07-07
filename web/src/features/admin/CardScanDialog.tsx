import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { extractCard, kioskNewMember, type NewMemberFields } from '../../lib/api'
import { easternNow } from '../../lib/checkinWindow'
import { NewFamilyCardForm } from './NewFamilyCardForm'
import { blankCardForm, groupForAffiliation, joinAffiliation, type CardFormValue } from './newFamilyCard'
import { normalizeExtractedCard } from './cardExtraction'
import { fileToCardImage } from './cardPhoto'

// 카드 사진으로 등록: photograph/upload the paper 새가족 등록 카드; the edge function
// has Gemini read the handwriting/checkboxes, and the result pre-fills the editable
// card replica for review — nothing is saved until the admin checks it and taps 등록.
// Registration goes through the same endpoint as the kiosk 새가족 등록, with an
// optional "오늘 출석 체크" (unchecked → skipCheckin, e.g. entering a stack of cards
// later in the week). Several photos can be picked at once — the stack is worked
// through one card at a time (extract → review → 등록/건너뛰기 → next), and a card
// that fails to extract is toasted with its position and the batch moves on.
type Phase = 'pick' | 'extracting' | 'review'

export function CardScanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('pick')
  const [queue, setQueue] = useState<File[]>([])
  const [index, setIndex] = useState(0)
  const [card, setCard] = useState<CardFormValue>(() => blankCardForm(easternNow().date))
  const [checkinToday, setCheckinToday] = useState(true)
  const [busy, setBusy] = useState(false)

  const patchCard = (patch: Partial<CardFormValue>) => setCard((cur) => ({ ...cur, ...patch }))

  // "카드 2 / 5" position tag — only meaningful for a multi-card batch.
  const progressTag = (list: File[], i: number) =>
    list.length > 1 ? t('admin.newfamily.scan.progress', { n: i + 1, total: list.length }) : ''

  // Back to a fresh pick — also clears the input's value so re-picking the same
  // file (after a failure or 다시 선택) re-fires onChange.
  function reset() {
    setPhase('pick')
    setQueue([])
    setIndex(0)
    setCard(blankCardForm(easternNow().date))
    setCheckinToday(true)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function close() {
    reset()
    onClose()
  }

  function pickFiles(files: FileList | null) {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setQueue(list)
    void processFile(list, 0)
  }

  // Extract card i of the batch. A card that can't be read (undecodable file, quota,
  // illegible photo) is toasted with its position and the batch moves on, so one bad
  // photo doesn't sink the whole stack.
  async function processFile(list: File[], i: number) {
    setIndex(i)
    setPhase('extracting')
    const tag = progressTag(list, i)
    const prefix = tag ? `${tag} — ` : ''
    let image: { base64: string; mediaType: string }
    try {
      image = await fileToCardImage(list[i])
    } catch {
      // Undecodable file (e.g. HEIC without browser support) — distinct message so
      // the fix ("use a JPG/screenshot") is obvious.
      toast({ title: prefix + t('admin.newfamily.scan.badImage'), tone: 'err' })
      advance(list, i)
      return
    }
    try {
      const res = await extractCard(image.base64, image.mediaType)
      setCard(normalizeExtractedCard(res.card, easternNow().date))
      setPhase('review')
    } catch (e) {
      // Surface the server's reason (missing secret, quota, unreadable card) —
      // these are actionable, unlike a generic failure.
      toast({ title: prefix + ((e as Error)?.message || t('admin.newfamily.scan.failed')), tone: 'err' })
      advance(list, i)
    }
  }

  // Move past card i without registering it: extract the next card, or fall back to
  // the picker after the last one (for a single photo that is exactly 다시 선택).
  function advance(list: File[], i: number) {
    if (i + 1 < list.length) void processFile(list, i + 1)
    else reset()
  }

  async function submit() {
    if (!card.name.trim()) {
      toast({ title: t('kiosk.newMember.nameRequired'), tone: 'warn' })
      return
    }
    // 소속 decides the 부서, so an unticked card can't be filed anywhere.
    if (!card.affiliationCategory) {
      toast({ title: t('kiosk.newMember.affiliationRequired'), tone: 'warn' })
      return
    }
    setBusy(true)
    try {
      const payload: NewMemberFields = {
        name: card.name.trim(),
        // Same mapping as the kiosk 새가족 등록: 부서 from 소속, 동산 assigned later.
        group: groupForAffiliation(card.affiliationCategory),
        subgroup: '',
        gender: card.gender,
        phone: card.phone.trim(),
        kakaoId: card.kakaoId.trim(),
        birthDate: card.birthDate || null,
        baptismStatus: card.baptismStatus,
        schoolOrWork: joinAffiliation(card.affiliationCategory, card.affiliationDetail),
        faithDuration: card.faithDuration.trim(),
        registrationDate: card.registrationDate || null,
        pastoralVisitRequested: card.pastoralVisitRequested,
        skipCheckin: !checkinToday,
      }
      await kioskNewMember(payload)
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast({ title: t('admin.newfamily.scan.done', { name: payload.name }), tone: 'ok' })
      if (index + 1 < queue.length) {
        // More cards in the stack — keep the dialog (and the 오늘 출석 체크 choice)
        // and roll straight into the next extraction.
        setBusy(false)
        void processFile(queue, index + 1)
      } else {
        close()
      }
    } catch (e) {
      toast({ title: (e as Error)?.message || t('common.error'), tone: 'err' })
      setBusy(false)
    }
  }

  const progress = progressTag(queue, index)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('admin.newfamily.scan.title')} wide>
      {phase === 'pick' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('admin.newfamily.scan.hint')}</p>
          {/* accept="image/*" without `capture` so mobile offers both camera and photo
              library; desktop gets the regular file picker. `multiple` lets a whole
              stack of cards be selected in one go. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            aria-label={t('admin.newfamily.scan.pick')}
            onChange={(e) => pickFiles(e.target.files)}
            className="text-xs text-muted file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-text"
          />
        </div>
      )}

      {phase === 'extracting' && (
        <p className="py-10 text-center text-sm text-muted">
          {progress && <span className="mb-1 block font-semibold text-primary">{progress}</span>}
          {t('admin.newfamily.scan.extracting')}
        </p>
      )}

      {phase === 'review' && (
        <>
          <p className="mb-3 text-sm text-muted">
            {progress && <span className="mr-2 font-semibold text-primary">{progress}</span>}
            {t('admin.newfamily.scan.reviewHint')}
          </p>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <NewFamilyCardForm value={card} onChange={patchCard} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={checkinToday} onChange={(e) => setCheckinToday(e.target.checked)} disabled={busy} />
            {t('admin.newfamily.scan.checkinToday')}
          </label>
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" onClick={() => advance(queue, index)} disabled={busy}>
              {queue.length > 1 ? t('admin.newfamily.scan.skip') : t('admin.newfamily.scan.retake')}
            </Button>
            <Button onClick={() => void submit()} disabled={busy} className="flex-1">
              {busy ? t('common.loading') : t('admin.newfamily.scan.submit')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
