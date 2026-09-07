import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { addIsoDays } from '../../lib/semester'
import { filterMembers, NO_FILTER, type Filter } from './filters'
import {
  visibleNewFamily,
  semesterBounds,
  semesterKey,
  matchesEduFilter,
  newFamilyWeek,
  type EduFilter,
  type NewFamilyWeek,
} from './newFamily'
import { NewFamilyWeekChip } from './NewFamilyWeekChip'
import { eduUnfinished, focusEduSession, needsEduWeek, nextEduSession, type EduSession } from './eduSchedule'
import {
  assignEduDongsan as planEduDongsan,
  clearEduDongsan,
  eduDongsanPlan,
  groupByEduDongsan,
  type EduAssignment,
  type EduDongsanGroup,
} from './eduDongsan'
import { composition } from './eduDongsanTraits'
import { presentToday, cameToday } from './today'
import { GroupFilter, Pill } from './GroupFilter'
import { assignEduDongsan, configCalendar, updateMember, type Member } from '../../lib/api'
import { Tag } from '../../components/ui/Tag'
import { useToast } from '../../components/ui/Toast'
import { GraduationCap, AlertTriangle, Check, ListChecks, Sprout } from '../../components/ui/Icon'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Dialog } from '../../components/ui/Dialog'
import { EditModal, AttendanceModal } from './MemberDialogs'
import { refreshRoster } from '../../lib/live'
import { useAppConfig } from '../../lib/useAppConfig'

const EDU_FILTERS: { key: EduFilter; labelKey: string }[] = [
  { key: 'week1', labelKey: 'admin.newfamily.eduFilter.week1' },
  { key: 'week2', labelKey: 'admin.newfamily.eduFilter.week2' },
  { key: 'both', labelKey: 'admin.newfamily.eduFilter.both' },
  { key: 'none', labelKey: 'admin.newfamily.eduFilter.none' },
]

// 오늘 예배에 온 새가족만 / 안 온 새가족만. 새가족 교육은 주일에 그 자리에 있는 사람과
// 하는 일이라, "오늘 누가 와 있나"가 이 탭에서 가장 먼저 필요한 질문이다 (그리고 남는
// 쪽이 그대로 연락할 명단이 된다).
type AttendFilter = 'all' | 'today' | 'notToday'

// 새가족 교육 tab: everything about tracking a current-semester 새가족's education —
// the 4-way completion filter (1주차/2주차/둘 다/안 들음), the 오늘 출석 filter, and the
// per-member 1·2주차 checkboxes. Visible to every admin; pastor is read-only like every
// other member-editing surface.
export function AdminNewFamilyEdu() {
  const { t, i18n } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useAppConfig()
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [eduFilter, setEduFilter] = useState<EduFilter>('all')
  const [attendFilter, setAttendFilter] = useState<AttendFilter>('all')
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  // 교육 동산에 넣을 사람을 고르는 자리. 필터를 바꿔도 선택은 남는다 — 골라 놓고 화면을
  // 좁혔다고 사람이 조용히 빠지면 배정에서 빠진 것을 알 길이 없다.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)

  if (isLoading) return (
    <div className="fx-fade grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => <div key={i} className="fx-skeleton h-28 rounded-2xl" />)}
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const today = easternNow().date
  // 부서·동산으로 좁힌다 — 다른 탭과 같은 GroupFilter, 같은 filterMembers.
  const scopedMembers = filterMembers(data.members, filter)
  // 새가족 표시가 붙어 있는 사람 전부 — 새가족 탭과 **같은 함수**라 표시를 붙이는 순간
  // 이 탭에도 같이 나타난다. **교육을 다 마쳐도 남는다**: 이수한 사람이 목록 밖으로 나가
  // 버리면 '수강 완료'로 걸러도 아무도 안 나와서, 정작 누가 이수했는지를 이 탭에서 볼 수
  // 없었다. 표시가 해제된 사람도 1년은 남는다 (visibleNewFamily 머리말).
  const inScope = visibleNewFamily(scopedMembers, today)
  // 오늘 온 사람 — 예배 출석 줄에서 id로 되찾는다 (이름은 예전 줄을 위한 대비책).
  const present = presentToday(data.log, today)
  const byEdu = eduFilter === 'all' ? inScope : inScope.filter((m) => matchesEduFilter(m, eduFilter))
  const visible =
    attendFilter === 'all' ? byEdu : byEdu.filter((m) => cameToday(m, present) === (attendFilter === 'today'))
  // 칩에 적을 수는 **교육 필터 안에서** 센다 — 칩을 눌렀을 때 실제로 남는 수와 같도록.
  const todayCount = byEdu.filter((m) => cameToday(m, present)).length
  const currentKey = semesterKey(today, configCalendar(cfg))
  // 이전 학기에서 넘어온 카드에는 등록 학기를 달아준다 (이번 학기면 null).
  const termLabel = (m: Member): string | null => {
    if (!m.registration_date || semesterKey(m.registration_date, configCalendar(cfg)) === currentKey) return null
    const { year, season } = semesterBounds(m.registration_date, configCalendar(cfg))
    return `${year} ${t(`admin.newfamily.season.${season}`)}`
  }
  const readOnly = data.role === 'pastor'

  // 이번에 여는 교육 — 주일 당일이면 그 날 것, 아니면 다음에 열리는 것 (eduSchedule).
  // 이 한 칸이 아래 목록을 가른다: 그 주차를 아직 안 들은 사람이 그 자리에 있어야 할
  // 사람이므로, 미수강도 다른 한 주차만 들은 사람도 함께 위로 올라온다.
  const session = focusEduSession(today)
  const openToday = !!session && session.date === today
  // 그다음 교육 — 한 바퀴에 쉬는 주일이 끼어 있어 "다음 주"가 아닐 때가 있다.
  const following = session ? nextEduSession(addIsoDays(session.date, 1)) : null
  // 위 블록은 **교육이 아직 안 끝난 사람 전부**다 (eduUnfinished 머리말): 오늘 여는 주차가
  // 비어 있는 사람에 더해, 오늘 것은 들었지만 나머지 한 주가 남은 사람까지. 그 안에서는
  // 오늘 그 자리에 앉을 사람(needsEduWeek)이 먼저 온다.
  const due = session
    ? visible
        .filter(eduUnfinished)
        .sort((a, b) => Number(needsEduWeek(b, session.week)) - Number(needsEduWeek(a, session.week)))
    : []
  const rest = session ? visible.filter((m) => !eduUnfinished(m)) : visible

  // 배정은 **고른 사람 전부**를 대상으로 한다 (지금 화면에 남아 있는 사람이 아니라) —
  // 위 필터는 고르는 것을 돕는 도구일 뿐이다.
  const selectedMembers = inScope.filter((m) => selected.has(m.id))
  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.id))
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const m of visible) if (allVisibleSelected) next.delete(m.id)
        else next.add(m.id)
      return next
    })
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // 이미 배정돼 있는 조들 — 카드마다 붙은 배지만으로는 "1동산이 누구누구인가"를 알려면
  // 화면을 훑어야 한다.
  const eduGroups = groupByEduDongsan(inScope)

  const grid = (list: Member[], highlight: boolean) => (
    <ul className="fx-stagger grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {list.map((m) => (
        <EduCard
          key={m.id}
          member={m}
          week={newFamilyWeek(m.registration_date, today)}
          here={cameToday(m, present)}
          term={termLabel(m)}
          due={highlight}
          selected={selected.has(m.id)}
          onSelect={() => toggleOne(m.id)}
          readOnly={readOnly}
          onOpen={() => setEditing(m)}
        />
      ))}
    </ul>
  )

  return (
    <>
      {/* 고르고 → 배정한다. 배정 버튼이 오른쪽 위에 있는 이유는 그것이 이 탭에서 유일하게
          여러 사람을 한 번에 바꾸는 일이기 때문 — 나머지는 카드 하나하나의 일이다. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={toggleAll} disabled={visible.length === 0}>
            <ListChecks className="size-4" aria-hidden />
            {t(allVisibleSelected ? 'admin.newfamilyEdu.select.none' : 'admin.newfamilyEdu.select.all')}
          </Button>
          {selected.size > 0 && (
            <span className="text-xs font-semibold text-primary">
              {t('admin.newfamilyEdu.select.count', { n: selected.size })}
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => setAssignOpen(true)} disabled={readOnly}>
          <Sprout className="size-4" aria-hidden />
          {t('admin.newfamilyEdu.assign.action')}
        </Button>
      </div>

      <GroupFilter members={data.members} value={filter} onChange={setFilter} />

      {/* 새가족 교육 이수 필터: 1주차만 / 2주차만 / 둘 다 / 아무것도 안 들음 */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Pill active={eduFilter === 'all'} onClick={() => setEduFilter('all')}>
          {t('admin.filter.all')}
        </Pill>
        {EDU_FILTERS.map(({ key, labelKey }) => (
          <Pill key={key} active={eduFilter === key} onClick={() => setEduFilter(key)}>
            {t(labelKey)}
          </Pill>
        ))}
      </div>

      {/* 오늘 출석 필터 — 위의 이수 필터와 곱해진다 (예: 1주차만 이수 × 오늘 출석 =
          오늘 2주차를 들을 사람). 카드마다 붙는 '오늘 출석' 표와 같은 기준이라 고른 칩과
          카드가 어긋나지 않는다. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 h-4 w-1 shrink-0 rounded-full bg-primary/40" aria-hidden />
        <Pill active={attendFilter === 'all'} onClick={() => setAttendFilter('all')}>
          {t('admin.filter.all')}
        </Pill>
        <Pill active={attendFilter === 'today'} onClick={() => setAttendFilter('today')}>
          {t('admin.newfamilyEdu.attend.today')} {todayCount}
        </Pill>
        <Pill active={attendFilter === 'notToday'} onClick={() => setAttendFilter('notToday')}>
          {t('admin.newfamilyEdu.attend.notToday')} {byEdu.length - todayCount}
        </Pill>
      </div>

      <div className="mb-3 flex items-center gap-2 section-kicker">
        <GraduationCap className="size-4 text-subtle" aria-hidden />
        {t('admin.newfamilyEdu.title')} · {visible.length}
      </div>

      <ScheduleBanner session={session} openToday={openToday} following={following} due={due.length} lang={i18n.language} />

      {eduGroups.length > 0 && <EduDongsanResult groups={eduGroups} />}

      {visible.length === 0 ? (
        <div className="fx-rise grid place-items-center rounded-2xl border border-dashed border-border py-14 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-fill text-subtle"><GraduationCap className="size-6" aria-hidden /></div>
          <p className="mt-4 text-sm font-semibold text-muted">
            {t(inScope.length === 0 ? 'admin.newfamily.empty' : 'admin.newfamily.noFilterMatch')}
          </p>
        </div>
      ) : !session ? (
        // 일정이 끝난 뒤 (12/27 다음): 가를 기준이 없으므로 예전처럼 한 목록이다.
        grid(visible, false)
      ) : (
        <>
          {/* 이번 주차를 아직 안 들은 사람이 먼저다 — 그 주일에 그 자리에 있어야 할 사람들. */}
          {due.length > 0 && (
            <>
              <div className="mb-2 flex items-center gap-2 section-kicker text-primary">
                <span className="h-3.5 w-1 rounded-full bg-primary" aria-hidden />
                {t('admin.newfamilyEdu.schedule.due')} · {due.length}
              </div>
              {grid(due, true)}
            </>
          )}
          {/* 나머지 — 이번 주차를 이미 들은 사람. 감추지 않는다 (이수 기록을 고칠 자리이고,
              여기서 사라지면 방금 체크한 사람이 통째로 없어진 것처럼 보인다). */}
          {rest.length > 0 && (
            <>
              <div className={(due.length > 0 ? 'mt-6 ' : '') + 'mb-2 flex items-center gap-2 section-kicker'}>
                {t('admin.newfamilyEdu.schedule.rest')} · {rest.length}
              </div>
              {grid(rest, false)}
            </>
          )}
        </>
      )}

      <EduDongsanDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        members={selectedMembers}
        onDone={() => setAssignOpen(false)}
      />

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

// 배정 결과 — 조별로 누가 있는지. 카드의 배지는 "이 사람이 몇 동산인가"에 답하지만,
// 교육 시간에 실제로 필요한 것은 그 반대다 ("1동산은 누구누구인가"). 배정된 사람이 하나도
// 없으면 이 블록 자체가 없다.
function EduDongsanResult({ groups }: { groups: EduDongsanGroup[] }) {
  const { t } = useTranslation()
  return (
    <div className="fx-rise mb-4 rounded-2xl border border-border bg-surface p-3.5">
      <div className="mb-2 flex items-center gap-2 section-kicker">
        <Sprout className="size-4 text-subtle" aria-hidden />
        {t('admin.newfamilyEdu.assign.result')}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.name} className="rounded-xl bg-fill px-3 py-2">
            <div className="text-xs font-semibold text-text">
              {g.name}
              <span className="ml-1 tabular-nums text-muted">· {g.members.length}</span>
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted">
              {g.members.map((m) => m.name).join(' · ')}
            </div>
            <GroupComposition members={g.members} />
          </div>
        ))}
      </div>
    </div>
  )
}

// 조가 어떻게 섞였는지 한 줄 — 성비 · 학교 · 전공 계열. 기준대로 나뉘었는지를 눈으로
// 검산하는 자리다 (숫자가 없으면 "정말 반반인가"를 이름을 세어 확인하게 된다). 적혀 있지
// 않은 값은 세지 않으므로 합이 인원과 다를 수 있다.
function GroupComposition({ members }: { members: Member[] }) {
  const { t } = useTranslation()
  const { male, female, cmu, pitt, fields } = composition(members)
  const parts: string[] = []
  if (male || female) parts.push(`${t('admin.newfamilyEdu.assign.male')} ${male} · ${t('admin.newfamilyEdu.assign.female')} ${female}`)
  if (cmu || pitt) parts.push(`CMU ${cmu} · Pitt ${pitt}`)
  for (const { field, n } of fields) parts.push(`${t(`admin.newfamilyEdu.assign.major.${field}`)} ${n}`)
  if (!parts.length) return null
  return <div className="mt-1 text-[11px] tabular-nums text-subtle">{parts.join(' · ')}</div>
}

// 동산 배정 창 — 고른 사람을 **부서 안에서** 무작위로 나눈다. 정하는 것은 동산 갯수 하나이고,
// 조마다 몇 명이 되는지는 누르기 전에 미리 보여준다 (무작위가 정하는 것은 누가 어디로
// 가느냐뿐이다). 배정 규칙(누구를 같이 두고 누구를 갈라놓을지)이 정해지면 eduDongsan.ts의
// 섞는 자리만 갈아 끼우면 되고 이 창은 그대로다.
const MAX_EDU_DONGSAN = 12

function EduDongsanDialog({
  open,
  onOpenChange,
  members,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  members: Member[] // 고른 사람들 (화면에 남아 있는 사람이 아니라)
  onDone: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [count, setCount] = useState(2)
  const [busy, setBusy] = useState(false)
  const plan = eduDongsanPlan(members, count)

  async function send(assignments: EduAssignment[], key: 'done' | 'cleared') {
    setBusy(true)
    try {
      const res = await assignEduDongsan(assignments)
      refreshRoster(qc)
      toast({ title: t(`admin.newfamilyEdu.assign.${key}`, { n: res.updated }), tone: 'ok' })
      onDone()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('admin.newfamilyEdu.assign.title')}>
      <p className="text-xs leading-relaxed text-muted">{t('admin.newfamilyEdu.assign.help')}</p>

      <label className="field-label mt-4" htmlFor="edu-dongsan-count">
        {t('admin.newfamilyEdu.assign.count')}
      </label>
      <Input
        id="edu-dongsan-count"
        type="number"
        min={1}
        max={MAX_EDU_DONGSAN}
        value={count}
        onChange={(e) => setCount(Math.min(MAX_EDU_DONGSAN, Math.max(1, Number(e.target.value) || 1)))}
      />

      {/* 부서마다 몇 명씩 나뉘는지 — 누르기 전에 보인다. 부서를 넘지 않으므로 줄도 부서마다다. */}
      <ul className="mt-3 grid gap-1.5">
        {members.length === 0 ? (
          <li className="rounded-xl bg-fill px-3 py-2 text-xs text-muted">{t('admin.newfamilyEdu.assign.none')}</li>
        ) : (
          plan.map((row) => (
            <li key={row.group || '—'} className="rounded-xl bg-fill px-3 py-2 text-xs text-text">
              <span className="font-semibold">{row.group || '—'}</span>
              <span className="text-muted">
                {' '}
                {t('admin.newfamilyEdu.assign.preview', { total: row.total, sizes: row.sizes.join(' · ') })}
              </span>
              {/* 그 부서에 걸리는 기준. 대학부만 성비·학교·전공을 맞추고 나머지는 무작위다. */}
              <div className="mt-0.5 text-[11px] text-subtle">
                {t(`admin.newfamilyEdu.assign.rule.${row.rule}`)}
                {/* 성별·학교가 비어 있는 사람은 그 기준으로 셀 수가 없다 — 적어 두지 않으면
                    "왜 성비가 안 맞지"가 된다. 배정에서 빠지는 것은 아니다. */}
                {row.rule === 'balanced' && (row.missing.gender > 0 || row.missing.school > 0) && (
                  <>
                    {' · '}
                    {t('admin.newfamilyEdu.assign.missing', {
                      gender: row.missing.gender,
                      school: row.missing.school,
                    })}
                  </>
                )}
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy || members.length === 0}
          onClick={() => void send(clearEduDongsan(members), 'cleared')}
        >
          {t('admin.newfamilyEdu.assign.clear')}
        </Button>
        <Button
          disabled={busy || members.length === 0}
          onClick={() => void send(planEduDongsan(members, count), 'done')}
        >
          <Sprout className="size-4" aria-hidden />
          {busy ? t('common.loading') : t('admin.newfamilyEdu.assign.run')}
        </Button>
      </div>
    </Dialog>
  )
}

// 이번에 여는 교육 한 줄 — 날짜 · 몇 주차 · 그 주차를 들을 사람 수. 이수 체크에는 날짜가
// 없으므로 (`new_member_edu_week1/2`는 참/거짓뿐이다) 지금 무엇을 여는지를 화면에 적어 두지
// 않으면 아래 목록이 왜 그렇게 갈렸는지가 보이지 않는다. 일정이 끝났으면 그 사실을 적는다 —
// 아무 말도 없으면 "교육이 없어졌나"가 된다.
function ScheduleBanner({
  session,
  openToday,
  following,
  due,
  lang,
}: {
  session: EduSession | null
  openToday: boolean // 오늘이 바로 그 주일인가 (아니면 다음에 열리는 것을 가리킨다)
  following: EduSession | null // 그다음 교육 — 쉬는 주일이 끼어 있어 '다음 주'가 아닐 수 있다
  due: number
  lang: string
}) {
  const { t } = useTranslation()
  const week = (n: number) => t('admin.newfamilyEdu.schedule.week', { n })
  if (!session)
    return (
      <p className="mb-4 rounded-2xl border border-dashed border-border px-3.5 py-2.5 text-xs text-muted">
        {t('admin.newfamilyEdu.schedule.ended')}
      </p>
    )
  return (
    <div className="fx-rise mb-4 rounded-2xl border border-primary/25 bg-primary/[0.06] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="section-kicker text-primary">
          {t(openToday ? 'admin.newfamilyEdu.schedule.today' : 'admin.newfamilyEdu.schedule.next')}
        </span>
        <span className="text-sm font-semibold text-text">{dateLabel(session.date, lang, { month: 'long', day: 'numeric' })}</span>
        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-white">{week(session.week)}</span>
        <span className="text-xs text-muted">{t('admin.newfamilyEdu.schedule.dueCount', { n: due })}</span>
      </div>
      {following && (
        <p className="mt-1 text-[11px] text-subtle">
          {t('admin.newfamilyEdu.schedule.following', {
            date: dateLabel(following.date, lang, { month: 'numeric', day: 'numeric' }),
            week: week(following.week),
          })}
        </p>
      )}
    </div>
  )
}

// ISO 날짜를 화면 언어로. 교육일은 언제나 주일이라 요일은 적지 않는다.
function dateLabel(iso: string, lang: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(lang.startsWith('ko') ? 'ko-KR' : 'en-US', { ...opts, timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  )
}

function EduCard({
  member,
  week,
  here,
  term,
  due,
  selected,
  onSelect,
  readOnly,
  onOpen,
}: {
  member: Member
  week: NewFamilyWeek | null
  here: boolean // 오늘 예배에 왔는가 — 위 '오늘 출석' 칩과 같은 기준
  term: string | null // 이전 학기에서 넘어온 새가족의 등록 학기 (이번 학기면 null)
  due: boolean // 이번에 여는 주차를 아직 안 들은 사람인가
  selected: boolean // 교육 동산 배정 대상으로 골랐는가
  onSelect: () => void
  readOnly: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState<'newMemberEduWeek1' | 'newMemberEduWeek2' | null>(null)

  async function toggleEdu(field: 'newMemberEduWeek1' | 'newMemberEduWeek2', value: boolean) {
    setBusy(field)
    try {
      await updateMember(member.id, { [field]: value })
      refreshRoster(qc)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <li
      className={
        'relative rounded-2xl border p-3.5 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow)] ' +
        (selected ? 'border-primary ring-2 ring-primary/40 bg-surface ' : due ? 'border-primary/40 bg-primary/[0.05]' : 'border-border bg-surface')
      }
    >
      {/* 고르는 자리는 카드 본문과 따로다 — 본문을 누르면 편집 창이 열리므로, 둘을 한
          버튼에 얹으면 이름을 확인하려다 선택이 바뀐다. */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={t('admin.newfamilyEdu.select.one', { name: member.name })}
        className={
          'absolute right-2.5 top-2.5 grid size-6 place-items-center rounded-full transition-colors ' +
          (selected ? 'bg-primary text-primary-fg' : 'border border-border bg-surface text-transparent hover:border-primary/40')
        }
      >
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      </button>
      {/* Tap the body to open the member's full info/editor (feature parity with 새가족 tab) */}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-1.5 pr-7 text-sm font-semibold text-text">
          {member.name}
          {/* 오늘 와 있는 사람 — 목록을 좁히지 않고도 눈에 띄도록 이름 옆에 점 하나. */}
          {here && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success"
              title={t('admin.newfamilyEdu.attend.today')}
            >
              <Check className="size-2.5" strokeWidth={3} aria-hidden />
              {t('admin.newfamilyEdu.attend.today')}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted">{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</div>
        {/* 이번 주 교육 동산 — 배정하면 카드에서 바로 읽힌다 (조별 명단은 위 블록에 있다). */}
        {member.new_member_dongsan && (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info">
              <Sprout className="size-3" aria-hidden />
              {member.new_member_dongsan}
            </span>
          </div>
        )}
        {/* 이번 주일에 등록한 새가족인지, 그 전 주에 등록했는지 — 교육 진도와 함께 보이도록. */}
        {(week === 'thisWeek' || week === 'lastWeek') && (
          <div className="mt-1.5"><NewFamilyWeekChip week={week} /></div>
        )}
        {/* 새가족 표시가 해제된 사람 — 해제 뒤 1년은 이 탭에도 남는다 (visibleNewFamily).
            이수 기록을 남기는 자리이므로 그 사람이 아직 새가족으로 표시돼 있는지가 보여야 한다. */}
        {!member.is_new_member && (
          <div className="mt-1.5">
            <Tag className="text-[10px]">{t('admin.newfamily.unmarked')}</Tag>
          </div>
        )}
        {/* 이전 학기에 등록했는데 교육이 남아 넘어온 새가족 — 어느 학기 사람인지 표시. */}
        {term && (
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-[10px] font-semibold text-muted">
            <GraduationCap className="size-3" aria-hidden />
            {term}
          </div>
        )}
      </button>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
        <EduCheck
          label={t('admin.newfamily.edu1')}
          checked={!!member.new_member_edu_week1}
          disabled={readOnly || busy !== null}
          onChange={(v) => void toggleEdu('newMemberEduWeek1', v)}
        />
        <EduCheck
          label={t('admin.newfamily.edu2')}
          checked={!!member.new_member_edu_week2}
          disabled={readOnly || busy !== null}
          onChange={(v) => void toggleEdu('newMemberEduWeek2', v)}
        />
      </div>
    </li>
  )
}

function EduCheck({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className={
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ' +
        (disabled ? 'cursor-not-allowed opacity-50 ' : '') +
        (checked ? 'bg-success/15 text-success' : 'bg-fill text-muted hover:text-text')
      }
    >
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={'grid size-4 place-items-center rounded-full ' + (checked ? 'bg-success text-white' : 'border border-border')}>
        {checked && <Check className="size-3" strokeWidth={3} aria-hidden />}
      </span>
      {label}
    </label>
  )
}
