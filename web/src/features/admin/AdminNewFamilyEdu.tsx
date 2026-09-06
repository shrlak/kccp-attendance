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
import { focusEduSession, needsEduWeek, nextEduSession, type EduSession } from './eduSchedule'
import { presentToday, cameToday } from './today'
import { GroupFilter, Pill } from './GroupFilter'
import { configCalendar, updateMember, type Member } from '../../lib/api'
import { Tag } from '../../components/ui/Tag'
import { useToast } from '../../components/ui/Toast'
import { GraduationCap, AlertTriangle, Check } from '../../components/ui/Icon'
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
  const due = session ? visible.filter((m) => needsEduWeek(m, session.week)) : []
  const rest = session ? visible.filter((m) => !needsEduWeek(m, session.week)) : visible

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
          readOnly={readOnly}
          onOpen={() => setEditing(m)}
        />
      ))}
    </ul>
  )

  return (
    <>
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
                {t('admin.newfamilyEdu.schedule.due', { week: t('admin.newfamilyEdu.schedule.week', { n: session.week }) })} · {due.length}
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
  readOnly,
  onOpen,
}: {
  member: Member
  week: NewFamilyWeek | null
  here: boolean // 오늘 예배에 왔는가 — 위 '오늘 출석' 칩과 같은 기준
  term: string | null // 이전 학기에서 넘어온 새가족의 등록 학기 (이번 학기면 null)
  due: boolean // 이번에 여는 주차를 아직 안 들은 사람인가
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
        'rounded-2xl border p-3.5 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow)] ' +
        (due ? 'border-primary/40 bg-primary/[0.05]' : 'border-border bg-surface')
      }
    >
      {/* Tap the body to open the member's full info/editor (feature parity with 새가족 tab) */}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
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
