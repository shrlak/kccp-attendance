import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { filterMembers, NO_FILTER, type Filter } from './filters'
import { semesterKey, newFamilyByDate, monthlyRegistrations } from './newFamily'
import { copyNewFamilyCards, saveNewFamilyCards } from './newFamilyCardImage'
import { newFamilySheets, NEW_FAMILY_HEADER } from './exports'
import { toggleId } from './bulk'
import { GroupFilter } from './GroupFilter'
import { getConfig, type Member } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { EditModal, AttendanceModal } from './MemberDialogs'
import { CardScanDialog } from './CardScanDialog'
import { IndividualImageCopyDialog, type IndividualCopyImage } from './IndividualImageCopyDialog'

// 새가족 (new-family) tab: registration tracking — current-semester new members grouped
// by 등록일, a monthly-registrations roll-up, card-photo registration, and export.
// Education tracking (1·2주차, 새가족 교육 동산) lives on the dedicated 새가족 교육 tab.
// Visible to every admin.
export function AdminNewFamily() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  const scopedMembers = filterMembers(data.members, filter)
  const dateGroups = newFamilyByDate(scopedMembers, today, cfg?.semesterDates)
  const allNewFamily = dateGroups.flatMap((g) => g.members)
  const total = allNewFamily.length
  const months = monthlyRegistrations(scopedMembers)
  const [, season] = semesterKey(today, cfg?.semesterDates).split('-')
  const year = semesterKey(today, cfg?.semesterDates).split('-')[0]
  const readOnly = data.role === 'pastor'

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />

      <div className="mb-1.5 flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
          {year} {t(`admin.newfamily.season.${season}`)}
        </span>
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.newfamily.title')} · {total}
        </span>
        <div className="ml-auto flex gap-2">
          {!readOnly && (
            <Button variant="secondary" size="sm" onClick={() => setScanOpen(true)}>
              {t('admin.newfamily.scan.action')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
            {t('admin.newfamily.export.action')}
          </Button>
        </div>
      </div>
      {/* Legend for the card badge below */}
      <p className="mb-3 text-xs text-subtle">{t('admin.newfamily.legend')}</p>

      {dateGroups.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.newfamily.empty')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {dateGroups.map((g) => (
            <div key={g.date ?? 'no-date'}>
              <div className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1">
                {g.date ? (
                  <span className="font-mono text-sm font-semibold text-text">{g.date}</span>
                ) : (
                  <span className="text-sm font-semibold text-warning">{t('admin.newfamily.noRegDate')}</span>
                )}
                <span className="text-xs text-subtle">{g.members.length}</span>
              </div>
              <ul className="grid grid-cols-4 gap-2">
                {g.members.map((m) => (
                  <NewFamilyCard key={m.id} member={m} onOpen={() => setEditing(m)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {months.length > 0 && (
        <div className="mt-8 border-t border-border pt-4">
          <div className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">{t('admin.newfamily.monthly')}</div>
          <div className="flex flex-col gap-4">
            {months.map((g) => (
              <div key={g.month}>
                <div className="mb-1.5 text-sm font-semibold text-text">
                  {g.month} · {g.members.length}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {g.members.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(m)}
                        className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted transition-colors hover:border-primary/30 hover:bg-surface-alt hover:text-text"
                      >
                        {m.name}
                        {[m.group_name, m.subgroup].filter(Boolean).length ? (
                          <span className="ml-1 text-subtle">· {[m.group_name, m.subgroup].filter(Boolean).join(' ')}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {exportOpen && <ExportModal members={allNewFamily} today={today} onClose={() => setExportOpen(false)} />}
      {scanOpen && <CardScanDialog open onClose={() => setScanOpen(false)} />}

      {editing && (
        <EditModal
          member={editing}
          onClose={() => setEditing(null)}
          onAttendance={() => {
            setAttendanceFor(editing)
            setEditing(null)
          }}
        />
      )}
      {attendanceFor && (
        <AttendanceModal
          member={attendanceFor}
          log={data.log}
          readOnly={readOnly}
          onClose={() => setAttendanceFor(null)}
        />
      )}
    </>
  )
}

// 새가족 정보를 회사의 레거시 로스터 스프레드시트와 같은 모양(부서별 탭, 파란 헤더, 12개
// 열)으로 내보낸다. XLSX.writeFile이 유일한 DOM 부수효과 — 행/시트 구성은 순수 함수
// (newFamilySheets, ./exports)에 있다.
async function exportNewFamilyExcel(members: Member[], today: string): Promise<void> {
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.utils.book_new()
  const headerStyle = {
    font: { name: 'Arial', bold: true },
    fill: { patternType: 'solid', fgColor: { rgb: 'FF6FA8DC' } },
    alignment: { horizontal: 'center' },
  }
  // 이름 / 등록일 / 성별 / 생년월일 / 전화번호 / 이메일 / 학교·직장 / 세례 / 주소·동네 / 동산 참여 / 목사님 심방 / 노트
  const colWidths = [14, 11, 7, 11, 14, 26, 22, 11, 16, 11, 11, 22].map((wch) => ({ wch }))
  for (const { name, aoa } of newFamilySheets(members)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    for (let c = 0; c < NEW_FAMILY_HEADER.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[addr]) ws[addr].s = headerStyle
    }
    // 등록일(열 1) / 생년월일(열 3) — 템플릿과 같은 실제 날짜 셀.
    for (let r = 1; r < aoa.length; r++) {
      for (const c of [1, 3]) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (ws[addr]?.t === 'n') ws[addr].z = 'm/d/yyyy'
      }
    }
    ws['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  XLSX.writeFile(wb, `새가족등록정보-${today}.xlsx`)
}

// Pick which 새가족 to export — as 등록 카드 JPGs, or as an Excel roster. Lists the whole
// current-semester tab (name-searchable), with today's registrations pre-checked — the
// previous "export today" behavior stays the default, but any subset of the semester can
// be chosen. Both actions share the same selection so there's one selection UI, not two.
function ExportModal({ members, today, onClose }: { members: Member[]; today: string; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(members.filter((m) => m.registration_date === today).map((m) => m.id)),
  )
  const [busy, setBusy] = useState<'cardsCopy' | 'cardsSave' | 'excel' | null>(null)
  const [individualCopies, setIndividualCopies] = useState<IndividualCopyImage[] | null>(null)

  const q = search.trim().toLowerCase()
  const visible = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members
  // Export in the tab's display order (newest registration date first).
  const chosen = () => members.filter((m) => selected.has(m.id))

  async function confirmCopyCards() {
    const list = chosen()
    if (!list.length) return
    setBusy('cardsCopy')
    try {
      const { status, cards } = await copyNewFamilyCards(list)
      if (status === 'copied') {
        toast({ title: t('admin.newfamily.export.cardsCopyDone'), tone: 'ok' })
        onClose()
      } else if (status === 'individual-required') {
        setIndividualCopies(list.map((member, index) => ({
          id: member.id,
          label: member.name,
          canvas: cards[index],
        })))
        setBusy(null)
      } else {
        toast({ title: t('admin.newfamily.export.cardsCopyFailed'), tone: 'err' })
        setBusy(null)
      }
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
      setBusy(null)
    }
  }

  async function confirmSaveCards() {
    const list = chosen()
    if (!list.length) return
    setBusy('cardsSave')
    try {
      await saveNewFamilyCards(list, today)
      toast({ title: t('admin.newfamily.export.cardsSaveDone'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
    }
    onClose()
  }

  async function confirmExcel() {
    const list = chosen()
    if (!list.length) return
    setBusy('excel')
    try {
      await exportNewFamilyExcel(list, today)
      toast({ title: t('admin.newfamily.export.excelDone'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.newfamily.export.excelFailed'), tone: 'err' })
    }
    onClose()
  }

  if (individualCopies) {
    return <IndividualImageCopyDialog items={individualCopies} onClose={onClose} />
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.newfamily.export.title')}>
      <p className="mb-3 text-sm text-muted">{t('admin.newfamily.export.select')}</p>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.members.search')}
        aria-label={t('admin.members.search')}
        className="mb-2"
      />
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.newfamily.export.selected', { n: selected.size })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSelected((cur) => new Set([...cur, ...visible.map((m) => m.id)]))}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {t('admin.newfamily.export.all')}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs font-semibold text-muted hover:underline"
          >
            {t('admin.newfamily.export.none')}
          </button>
        </div>
      </div>
      <ul className="flex max-h-[42vh] flex-col gap-1 overflow-y-auto pr-1">
        {visible.length === 0 && <li className="text-sm text-muted">{t('admin.newfamily.export.noMatch')}</li>}
        {visible.map((m) => (
          <li key={m.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-alt">
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                disabled={busy !== null}
                onChange={() => setSelected((cur) => toggleId(cur, m.id))}
              />
              <span className="font-medium text-text">{m.name}</span>
              <span className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ')}</span>
              {m.registration_date && (
                <span className="ml-auto font-mono text-[11px] text-subtle">{m.registration_date}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void confirmCopyCards()} disabled={busy !== null || selected.size === 0} className="flex-1 whitespace-pre-line text-center leading-tight">
          {busy === 'cardsCopy' ? t('admin.newfamily.export.cardsCopyBusy') : t('admin.newfamily.export.cardsCopyConfirm', { n: selected.size })}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void confirmSaveCards()}
          disabled={busy !== null || selected.size === 0}
          className="flex-1 whitespace-pre-line text-center leading-tight"
        >
          {busy === 'cardsSave' ? t('admin.newfamily.export.cardsSaveBusy') : t('admin.newfamily.export.cardsSaveConfirm', { n: selected.size })}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void confirmExcel()}
          disabled={busy !== null || selected.size === 0}
          className="flex-1 whitespace-pre-line text-center leading-tight"
        >
          {busy === 'excel' ? t('admin.newfamily.export.excelBusy') : t('admin.newfamily.export.excelConfirm', { n: selected.size })}
        </Button>
      </div>
    </Dialog>
  )
}

function NewFamilyCard({ member, onOpen }: { member: Member; onOpen: () => void }) {
  const { t } = useTranslation()

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      {/* Tap the card to open the member's full info/editor (feature parity with 멤버 탭).
          Education tracking (1·2주차, 새가족 교육 동산) lives on the 새가족 교육 탭 — this
          card stays focused on registration info, with a read-only glance at their
          education status. */}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="text-sm font-semibold text-text">
          {member.name}
          {member.pastoral_visit_requested && (
            <span className="ml-1.5 text-xs" title={t('admin.newfamily.pastoralVisit')}>🙏</span>
          )}
        </div>
        <div className="text-xs text-muted">{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</div>
        {member.new_member_dongsan && (
          <div className="text-xs text-info">
            {t('admin.newfamily.eduDongsanTag')} {member.new_member_dongsan}
          </div>
        )}
        {member.phone && <div className="text-xs text-subtle">{member.phone}</div>}
        {(member.new_member_edu_week1 || member.new_member_edu_week2) && (
          <div className="mt-1 flex gap-1">
            {member.new_member_edu_week1 && (
              <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info">{t('admin.iconKey.eduWeek1')}</span>
            )}
            {member.new_member_edu_week2 && (
              <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info">{t('admin.iconKey.eduWeek2')}</span>
            )}
          </div>
        )}
      </button>
    </li>
  )
}
