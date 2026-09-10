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
import { NewFamilyFacts } from './NewFamilyFacts'
import {
  eduStage,
  eduUnfinished,
  focusEduSession,
  needsEduWeek,
  nextEduSession,
  type EduSession,
} from './eduSchedule'
import {
  assignEduDongsan as planEduDongsan,
  clearEduDongsan,
  eduDongsanPlan,
  eduGroupBounds,
  groupByEduDongsan,
  ruleForGroup,
  type EduAssignment,
  type EduDongsanGroup,
} from './eduDongsan'
import { composition, schoolOf, SCHOOL_NAMES } from './eduDongsanTraits'
import { presentToday, cameToday } from './today'
import { GroupFilter, Pill } from './GroupFilter'
import { assignEduDongsan, clearAllEduDongsan, configCalendar, updateMember, type Member } from '../../lib/api'
import { Tag } from '../../components/ui/Tag'
import { useToast } from '../../components/ui/Toast'
import { GraduationCap, AlertTriangle, Check, ListChecks, Sprout, Trash2 } from '../../components/ui/Icon'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
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
  // 아직 두 주를 다 마치지 않은 사람 — 위 블록의 명단이자, 전체 선택이 집는 명단이다.
  const unfinished = visible.filter(eduUnfinished)
  const due = session
    ? [...unfinished].sort((a, b) => Number(needsEduWeek(b, session.week)) - Number(needsEduWeek(a, session.week)))
    : []
  const rest = session ? visible.filter((m) => !eduUnfinished(m)) : visible

  // 배정은 **고른 사람 전부**를 대상으로 한다 (지금 화면에 남아 있는 사람이 아니라) —
  // 위 필터는 고르는 것을 돕는 도구일 뿐이다.
  const selectedMembers = inScope.filter((m) => selected.has(m.id))
  // 전체 선택이 집는 것은 **아직 교육이 남은 사람**뿐이다 (unfinished). 이 버튼이 있는
  // 이유가 교육 동산 배정이고, 그 조에 앉을 사람은 아직 들을 주차가 남은 사람이기 때문 —
  // 수강 완료한 사람까지 한 번에 딸려 들어가면 배정 창에서 다시 하나씩 빼게 된다. 그
  // 사람들을 넣어야 할 때는 카드에서 직접 고른다 (이 버튼이 그 길을 막지는 않는다).
  const allUnfinishedSelected = unfinished.length > 0 && unfinished.every((m) => selected.has(m.id))
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const m of unfinished) if (allUnfinishedSelected) next.delete(m.id)
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
          여러 사람을 한 번에 바꾸는 일이기 때문 — 나머지는 카드 하나하나의 일이다.
          전체 선택은 여기가 아니라 **목록 머리줄**에 있다: 그 버튼이 집는 것은 필터를 거친
          뒤의 명단이라, 필터 위에 있으면 무엇을 고르는 버튼인지가 순서에서 드러나지 않는다. */}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
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

      {/* 목록 머리줄 — 전체 선택이 여기 앉는다. section-kicker는 라벨에만 걸린다
          (그 클래스의 uppercase가 버튼 안까지 내려가면 영어 UI에서 버튼 글자가 대문자가 된다). */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 section-kicker">
          <GraduationCap className="size-4 text-subtle" aria-hidden />
          {t('admin.newfamilyEdu.title')} · {visible.length}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <span className="text-xs font-semibold text-primary">
              {t('admin.newfamilyEdu.select.count', { n: selected.size })}
            </span>
          )}
          <Button size="sm" variant="secondary" onClick={toggleAll} disabled={unfinished.length === 0}>
            <ListChecks className="size-4" aria-hidden />
            {t(allUnfinishedSelected ? 'admin.newfamilyEdu.select.none' : 'admin.newfamilyEdu.select.all')}
          </Button>
        </div>
      </div>

      <ScheduleBanner session={session} openToday={openToday} following={following} due={due.length} lang={i18n.language} />

      {eduGroups.length > 0 && <EduDongsanResult groups={eduGroups} readOnly={readOnly} />}

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
function EduDongsanResult({ groups, readOnly }: { groups: EduDongsanGroup[]; readOnly: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState<{ member: Member; from: string } | null>(null)
  const shown = groups.reduce((n, g) => n + g.members.length, 0)

  // 옮겨 갈 수 있는 조 — 같은 부서의 다른 조들. 조의 부서는 그 조 사람의 부서로 읽는다
  // (조 이름이 부서로 시작하지만 이름을 파싱하는 것보다 사람에게 묻는 편이 틀리지 않는다).
  const targetsFor = ({ member, from }: { member: Member; from: string }) =>
    groups
      .filter((g) => g.name !== from && g.members[0]?.group_name === member.group_name)
      .map((g) => g.name)

  // 한 사람을 옮기는 것은 배정 요청 한 줄이다 (`dongsan:""`면 해제) — 서버는 같은 길을 쓴다.
  async function move(to: string) {
    if (!moving) return
    setBusy(true)
    try {
      await assignEduDongsan([{ memberId: moving.member.id, dongsan: to }])
      refreshRoster(qc)
      toast({
        title: to
          ? t('admin.newfamilyEdu.assign.move.done', { name: moving.member.name, to })
          : t('admin.newfamilyEdu.assign.move.cleared', { name: moving.member.name }),
        tone: 'ok',
      })
      setMoving(null)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  // 화면이 아는 사람만이 아니라 **그 부에 남아 있는 배정 전부**를 지운다 (서버가 범위 안에서
  // 훑는다). 배정 해제는 고른 사람만 지우므로, 새가족 표시가 내려갔거나 필터에 걸러진 사람에게
  // 남은 값은 그 길로는 닿지 않는다 — 여기가 그 값을 걷어내는 자리다.
  async function clearAll() {
    setBusy(true)
    try {
      const res = await clearAllEduDongsan()
      refreshRoster(qc)
      toast({ title: t('admin.newfamilyEdu.assign.clearAllDone', { n: res.updated }), tone: 'ok' })
      setConfirming(false)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fx-rise mb-4 rounded-2xl border border-border bg-surface p-3.5">
      <div className="mb-2 flex items-center gap-2 section-kicker">
        <Sprout className="size-4 text-subtle" aria-hidden />
        {t('admin.newfamilyEdu.assign.result')}
        {!readOnly && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
            <Trash2 className="size-3.5" aria-hidden />
            {t('admin.newfamilyEdu.assign.clearAll')}
          </Button>
        )}
      </div>
      {/* 조마다 카드 하나, 그 안에 사람이 이름표로 앉는다. 이름표를 누르면 다른 조로 옮긴다 —
          기준이 뽑아 준 배치가 늘 맞는 것은 아니라(친한 사람 둘, 늦게 온 한 사람) 손으로
          고칠 자리가 있어야 한다. 끌어다 놓기가 아니라 눌러서 고르는 이유는 이 화면이 주로
          폰에서 열리기 때문이다 — 손가락으로 끄는 동작은 목록이 함께 스크롤되는 자리에서 자주
          어긋난다. */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.name} className="rounded-xl bg-fill px-3 py-2.5">
            <div className="text-xs font-semibold text-text">
              {g.name}
              <span className="ml-1 tabular-nums text-muted">· {g.members.length}</span>
            </div>
            <GroupWho members={g.members} />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {g.members.map((m) =>
                readOnly ? (
                  <span key={m.id} className="rounded-full border border-border bg-surface px-2 py-1 text-xs text-text">
                    {m.name}
                  </span>
                ) : (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMoving({ member: m, from: g.name })}
                    className="rounded-full border border-border bg-surface px-2 py-1 text-xs font-medium text-text transition-colors hover:border-primary/40 hover:text-primary active:scale-[0.97]"
                  >
                    {m.name}
                  </button>
                ),
              )}
            </div>
            <GroupComposition members={g.members} />
          </div>
        ))}
      </div>
      {!readOnly && (
        <p className="mt-2 text-[11px] text-subtle">{t('admin.newfamilyEdu.assign.move.hint')}</p>
      )}

      {/* 옮길 곳은 **같은 부서의 조**뿐이다 — 부서를 넘지 않는 것은 이 기능의 규칙이라
          손으로도 넘기지 않는다 (대학부 사람이 청년부 조에 앉으면 그 조의 이름이 거짓말이 된다). */}
      <Dialog
        open={!!moving}
        onOpenChange={(v) => !v && setMoving(null)}
        title={t('admin.newfamilyEdu.assign.move.title')}
      >
        {moving && (
          <>
            <p className="text-xs leading-relaxed text-muted">
              {t('admin.newfamilyEdu.assign.move.help', { name: moving.member.name, from: moving.from })}
            </p>
            <ul className="mt-4 grid gap-1.5">
              {targetsFor(moving).map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void move(name)}
                    className="w-full rounded-xl bg-fill px-3 py-2.5 text-left text-sm font-semibold text-text transition-colors hover:bg-fill-hover disabled:opacity-40"
                  >
                    {name}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void move('')}
                  className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
                >
                  {t('admin.newfamilyEdu.assign.move.unassign')}
                </button>
              </li>
            </ul>
          </>
        )}
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming} title={t('admin.newfamilyEdu.assign.clearAllTitle')}>
        <p className="text-xs leading-relaxed text-muted">
          {t('admin.newfamilyEdu.assign.clearAllWarn', { n: shown })}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void clearAll()}>
            <Trash2 className="size-4" aria-hidden />
            {busy ? t('common.loading') : t('admin.newfamilyEdu.assign.clearAllConfirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

// 그 조가 어느 부서의 어느 단계인가. **조 이름이 번호뿐이라 이름은 그것을 말해 주지 않는다**
// — 그래서 그 조에 앉은 사람들에게 묻는다. 손으로 옮긴 뒤에는 한 카드에 단계가 섞일 수 있어
// (같은 부서 안에서는 어디로든 옮길 수 있다) 나오는 것을 그대로 적는다.
function GroupWho({ members }: { members: Member[] }) {
  const { t } = useTranslation()
  const uniq = (xs: string[]) => [...new Set(xs)]
  const groups = uniq(members.map((m) => m.group_name || '').filter(Boolean))
  const stages = uniq(members.map((m) => eduStage(m))).map((s) => t(`admin.newfamily.eduFilter.${s}`))
  const parts = [...groups, ...stages]
  if (!parts.length) return null
  return <div className="text-[11px] text-muted">{parts.join(' · ')}</div>
}

// 조가 어떻게 섞였는지 한 줄 — 성비 · 학교 · 전공 계열. 기준대로 나뉘었는지를 눈으로
// 검산하는 자리다 (숫자가 없으면 "정말 반반인가"를 이름을 세어 확인하게 된다). 적혀 있지
// 않은 값은 세지 않으므로 합이 인원과 다를 수 있다.
function GroupComposition({ members }: { members: Member[] }) {
  const { t } = useTranslation()
  // 그 조가 어떤 사람들인지 한 줄 — 그 부서의 기준이 보는 칸만 적는다 (대학부 카드에 신앙
  // 연차가 뜨면 그 기준으로 나눈 줄 알게 되고, 기준이 없는 부서에는 적을 것이 없다).
  const rule = ruleForGroup(members[0]?.group_name || '')
  if (!rule) return null
  const c = composition(members)
  const parts: string[] = []
  for (const { key } of [...rule.spread, ...rule.cluster]) {
    if (key === 'gender' && (c.male || c.female))
      parts.push(`${t('admin.newfamilyEdu.assign.male')} ${c.male} · ${t('admin.newfamilyEdu.assign.female')} ${c.female}`)
    if (key === 'school' && c.schools.length)
      parts.push(c.schools.map((x) => `${SCHOOL_NAMES[x.school]} ${x.n}`).join(' · '))
    if (key === 'age' && c.birthYears)
      parts.push(
        c.birthYears.min === c.birthYears.max
          ? t('admin.newfamilyEdu.assign.bornOne', { year: c.birthYears.min })
          : t('admin.newfamilyEdu.assign.bornRange', { min: c.birthYears.min, max: c.birthYears.max }),
      )
    if (key === 'career')
      for (const x of c.careers) parts.push(`${t(`admin.newfamilyEdu.assign.career.${x.career}`)} ${x.n}`)
    if (key === 'major')
      for (const x of c.fields) parts.push(`${t(`admin.newfamilyEdu.assign.major.${x.field}`)} ${x.n}`)
    if (key === 'faith')
      for (const x of c.faith) parts.push(`${t(`admin.newfamilyEdu.assign.faith.${x.stage}`)} ${x.n}`)
  }
  if (!parts.length) return null
  return <div className="mt-1 text-[11px] tabular-nums text-subtle">{parts.join(' · ')}</div>
}

// 동산 배정 창 — 고른 사람을 **부서 안에서** 무작위로 나눈다. 정하는 것은 **조 갯수 하나**이고,
// 어느 묶음이 몇 조로 갈리는지도 누르기 전에 미리 보여준다 (무작위가 정하는 것은 누가 어디로
// 가느냐뿐이다). 배정 규칙(누구를 같이 두고 누구를 갈라놓을지)이 정해지면 eduDongsan.ts의
// 섞는 자리만 갈아 끼우면 되고 이 창은 그대로다.

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
  const [busy, setBusy] = useState(false)
  // **전체를 몇 조로 나눌지** (한 묶음을 몇으로 쪼갤지가 아니다). 적은 수는 부서×단계 묶음에
  // 나뉘어 들어가고(`allocateGroups`), 묶음을 넘는 조는 설 수 없으므로 **아래위 끝이 있다** —
  // 적은 값이 그 밖이면 끝으로 당겨 쓰고 칸에도 당겨진 값을 그대로 보여준다 (창에 3이 적혀
  // 있는데 4조가 나오면 어디서 어긋났는지 알 수 없다). 한 묶음이 둘 이상으로 갈릴 때 비로소
  // 부서별 기준(성비·나이·학교·전공·신앙)이 누가 어느 쪽으로 갈지를 정한다.
  const bounds = eduGroupBounds(members)
  const [wanted, setWanted] = useState(1)
  const count = Math.min(Math.max(wanted, bounds.min), Math.max(bounds.max, 1))
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
        {t('admin.newfamilyEdu.assign.groups')}
      </label>
      <Input
        id="edu-dongsan-count"
        type="number"
        min={Math.max(bounds.min, 1)}
        max={Math.max(bounds.max, 1)}
        value={count}
        onChange={(e) => setWanted(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
      />
      <p className="mt-1 text-[11px] leading-relaxed text-subtle">
        {t('admin.newfamilyEdu.assign.groupsHint')}
        {/* 왜 이 수보다 적게(많게) 못 나누는지를 그 자리에 적어 둔다 — 칸이 저절로 바뀌는
            이유가 화면 어디에도 없으면 고장으로 읽힌다. */}
        {members.length > 0 && (
          <>
            {' '}
            {t('admin.newfamilyEdu.assign.groupsRange', { min: bounds.min, max: bounds.max })}
          </>
        )}
      </p>

      {/* 누르기 전에 어떤 조가 생기는지 그대로 보여준다 — 단계마다 몇 조가 서고 조마다 몇 명이
          되는지까지. 무작위가 정하는 것은 누가 어디로 가느냐뿐이라 이 수는 그대로 맞는다. */}
      <ul className="mt-3 grid gap-1.5">
        {members.length === 0 ? (
          <li className="rounded-xl bg-fill px-3 py-2 text-xs text-muted">{t('admin.newfamilyEdu.assign.none')}</li>
        ) : (
          plan.map((row) => (
            <li key={row.group} className="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-xs text-text">
              <Sprout className="size-3.5 shrink-0 text-subtle" aria-hidden />
              <span className="font-semibold">{row.group || t('admin.newfamilyEdu.assign.noGroup')}</span>
              <span className="ml-auto tabular-nums text-muted">
                {t('admin.newfamilyEdu.assign.count', { n: row.total })}
                {/* 어느 묶음이 몇 조가 되는지까지 적는다 — 이름이 번호뿐이라 창을 닫고 나면
                    `1조`가 어느 묶음이었는지 알 길이 없다. 한 조로 갈 때는 인원이 곧 그
                    조이므로 나눗셈을 적지 않는다. */}
                {` → ${row.names
                  .map((name, i) => (row.names.length > 1 ? `${name} ${row.sizes[i]}` : name))
                  .join(' · ')}`}
              </span>
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
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</span>
          <SchoolMark member={member} />
        </div>
        {/* 학교/직장 · 세례여부 · 신앙생활 — 새가족 탭의 카드와 **같은 컴포넌트**다
            (NewFamilyFacts). 위의 SchoolMark는 배정 기준이 읽어낸 학교 하나를 짧게 짚는
            자리이고, 여기 적히는 것은 그 칸에 실제로 적힌 말이다. */}
        <NewFamilyFacts member={member} />
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

// 학교 마크 — CMU인지 Pitt인지를 카드에서 바로 읽는다. **적어 주기만 하고 가르지는 않는다**:
// 교육 조를 나누는 것은 부서와 교육 단계이고(eduDongsan), 학교는 이 시스템의 칸이 아니라
// `school_or_work`에 손으로 적힌 말에서 읽어낸 값이라(`schoolOf`) 조를 세울 근거로 쓰기에는
// 늘 맞지 않는다. 못 읽으면 아무것도 붙이지 않는다 — '모름' 딱지는 알려주는 것이 없다.
function SchoolMark({ member }: { member: Member }) {
  const school = schoolOf(member)
  if (!school) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-fill px-1.5 py-0.5 text-[10px] font-semibold text-subtle">
      <GraduationCap className="size-2.5" aria-hidden />
      {SCHOOL_NAMES[school]}
    </span>
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
