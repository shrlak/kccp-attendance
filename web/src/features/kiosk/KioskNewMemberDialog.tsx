import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Sparkles } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { kioskNewMember, type NewMemberFields } from '../../lib/api'
import { easternNow } from '../../lib/checkinWindow'
import { NewFamilyCardForm } from '../admin/NewFamilyCardForm'
import { AdultCardForm } from '../admin/AdultCardForm'
import { blankAdultCard, type AdultCardValue } from '../admin/adultCard'
import { adultPayload } from '../admin/adultRegistration'
import { newHouseholdId, spouseName, spousePayload, spouseRows } from '../admin/adultSpouse'
import { blankCardForm, groupForAffiliation, joinAffiliation, type CardFormValue } from '../admin/newFamilyCard'
import { usePartition } from '../../lib/useAppConfig'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { groupsOfPartition } from '../../lib/partition'
import { refreshRoster } from '../../lib/live'

// 새가족 (new-family) registration from the kiosk: a blank paper 새가족 등록 카드 to
// fill in directly — type into the card's cells, tap its checkboxes. 등록일 is stamped
// to the day the person is added (the server stamps the same date authoritatively).
// There are no 부서/동산 controls: 부서 is derived from the card's 소속 category
// (대학생 → 대학부, else → 청년부) and 동산 is assigned later in the Members tab.
// Creates the member/device and checks them in for today.
//
// **필수는 이름 하나뿐이다.** 나머지 칸은 비어 있어도 등록된다 — 카드 사진 등록이 이미 그
// 규칙으로 돌고 있었고(cardRegistration.ts), 같은 종이를 손으로 옮겨 적는 이 화면만 더
// 까다로울 이유가 없다. 특히 소속은 오래 필수였는데, 그 칸이 정하는 것은 부서 하나이고
// 부서는 비었을 때 넣을 값이 이미 정해져 있다 (아래 fallbackGroup) — 그 사람을 등록조차
// 못 하게 만드는 대신 기본 부서로 넣고 멤버 탭에서 고친다.
// 이름만은 남는다: 이름이 이 시스템의 신원이라(출석부·키오스크가 이름으로 사람을 찾는다)
// 빈 이름은 명단에 올려도 아무도 찾지 못한다. 카드 사진 쪽이 이름을 자리표로 채우는 것은
// 종이가 곧 사라지기 때문이고, 여기서는 적는 사람이 그 자리에 서 있다.
export function KioskNewMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const partition = usePartition()
  // Fresh blank card per open, 등록일 = today (Eastern) — computed per open so the
  // kiosk doesn't stamp a stale date if it stays up across midnight.
  const [card, setCard] = useState<CardFormValue>(() => blankCardForm(easternNow().date))
  // 장년부는 종이가 다르다 — 키오스크에서도 그 부의 카드를 그대로 내민다.
  const isAdult = partition === 'adult'
  const [adultCard, setAdultCard] = useState<AdultCardValue>(() => blankAdultCard(easternNow().date))
  const [busy, setBusy] = useState(false)
  // 소속이 비었을 때 넣을 부서. 리더는 자기 부서 밖으로 등록할 수 없으므로(서버
  // inScopeGroup) 늘 청년부로 떨어뜨리면 대학부 리더에게 403이 난다 — 카드 사진 등록이
  // 쓰는 규칙 그대로다 (CardScanDialog).
  const scopedGroup = useAdminAuth((s) => s.identity?.group ?? '')
  const fallbackGroup = groupsOfPartition(partition).includes(scopedGroup)
    ? scopedGroup
    : groupForAffiliation('', partition)

  const patchCard = (patch: Partial<CardFormValue>) => setCard((cur) => ({ ...cur, ...patch }))
  const patchAdultCard = (patch: Partial<AdultCardValue>) => setAdultCard((cur) => ({ ...cur, ...patch }))

  function close() {
    setCard(blankCardForm(easternNow().date))
    setAdultCard(blankAdultCard(easternNow().date))
    setBusy(false)
    onClose()
  }

  async function submit() {
    const name = (isAdult ? adultCard.name : card.name).trim()
    if (!name) {
      toast({ title: t('kiosk.newMember.nameRequired'), tone: 'warn' })
      return
    }
    setBusy(true)
    try {
      // 부부가 한 카드에 적혀 있으면 두 사람이 된다 (adultSpouse.ts) — 배우자도 자기
      // 출석을 찍으므로 명단에 자기 행이 있어야 한다.
      const spouses = isAdult ? spouseRows(adultCard.family) : []
      const householdId = spouses.length > 0 ? newHouseholdId() : ''
      const payload: NewMemberFields = isAdult ? adultPayload(adultCard, householdId) : {
        name: card.name.trim(),
        // 부서 from the 소속 checkbox: 대학생 → 대학부, 대학원생/직장인/Other → 청년부.
        // 아무 네모도 안 찍혔으면 기본 부서로 — 그 칸 때문에 등록이 막히지 않는다.
        group: card.affiliationCategory.trim()
          ? groupForAffiliation(card.affiliationCategory, partition)
          : fallbackGroup,
        // 동산 is assigned by an admin in the Members tab, never at the kiosk.
        subgroup: '',
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
      // 배우자는 본인 등록이 끝난 뒤에 한 명씩. 한 명이 실패해도 이미 들어간 본인을
      // 되돌리지 않는다 — 빠진 사람만 다시 넣으면 된다.
      const failed: string[] = []
      for (const row of spouses) {
        try {
          await kioskNewMember(spousePayload(adultCard, row, householdId))
        } catch {
          failed.push(spouseName(row))
        }
      }
      refreshRoster(qc)
      const registered = [payload.name, ...spouses.map(spouseName).filter((n) => !failed.includes(n))]
      toast({ title: t('kiosk.newMember.done', { name: registered.join(', ') }), tone: 'ok' })
      if (failed.length > 0) toast({ title: t('kiosk.newMember.spouseFailed', { name: failed.join(', ') }), tone: 'err' })
      close()
    } catch (e) {
      // Surface the real reason (auth/network/server message) instead of a generic error,
      // so a failing kiosk is diagnosable rather than silently "not working".
      toast({ title: (e as Error)?.message || t('common.error'), tone: 'err' })
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('kiosk.newMember.title')} wide xwide={isAdult}>
      {/* max-h is a safety valve for short/small screens; on the kiosk tablet the whole
          card fits without scrolling. */}
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        {isAdult ? (
          <AdultCardForm value={adultCard} onChange={patchAdultCard} />
        ) : (
          <NewFamilyCardForm value={card} onChange={patchCard} regDateFixed />
        )}
      </div>
      {/* 필수가 이름 하나뿐이라는 것은 화면을 봐서는 알 수 없다 — 빈 칸을 남겨도 되는지
          몰라 붙들려 있는 것이, 이 규칙을 바꾼 이유 그 자체다. */}
      <p className="mt-4 rounded-xl bg-fill px-3 py-2 text-[11px] leading-5 text-subtle">
        {t('kiosk.newMember.optionalHint')}
      </p>
      <Button onClick={() => void submit()} disabled={busy} className="mt-3 w-full">
        <Sparkles className="size-4" strokeWidth={2} aria-hidden />
        {busy ? t('common.loading') : t('kiosk.newMember.submit')}
      </Button>
    </Dialog>
  )
}
