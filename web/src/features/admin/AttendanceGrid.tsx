import {
  buildAttendanceModel,
  attendanceGroupBy,
  blockColors,
  cssColor,
  exportSundays,
  semesterLabel,
  filterLabel,
  HEADER_TOTAL_FILL,
  KEY_FILL,
  NOTE_FILL,
  type Lang,
} from './exports'
import type { LogEntry, Member } from '../../lib/api'
import type { CalendarLike } from '../../lib/semester'
import { orderByDongsanRole } from './dongsan'
import { useDongsanRole } from './useDongsanRole'
import { useUnitTerms, usePartition } from '../../lib/useAppConfig'
import type { Filter } from './filters'

// On-screen 출석부: an exact preview of the exported "Attendance" sheet. Members are split
// into color-coded 동산 blocks (green → blue → yellow → red), each a single date-header row
// over O = 출석 (green) / X = 결석 (red) cells — status marks (한국 귀국 / 이주 / 새가족 …)
// render as grey cells spanning the dates they cover, like the master sheet — a per-member
// 예배 총 출석 count and a 총 출석 totals row, opened by the KEY legend up top — see
// exports.ts (gridSheet / reportHtml) for the shared spine. Date columns are the term's
// worship Sundays. Each block lists its 동산지기 first, then 부동산지기, then the rest in
// roster order, with the leaders' name cells bolded + highlighted (no icon).
// 칸의 테두리는 **오른쪽·아래만** 긋고(표가 왼쪽·위를 긋는다) `border-separate`로 둔다.
// `border-collapse`에서는 테두리가 칸이 아니라 표의 것이라, 고정(sticky)된 칸이 움직여도 테두리는
// 제자리에 남는다 — 머리줄과 이름 열을 고정하면 그 칸들만 테두리 없이 떠다녔다.
const CELL = 'whitespace-nowrap border-b border-r border-[#b7b7b7] px-1.5 py-1 sm:px-3 sm:py-1.5'
// Variable-length cells (names, status notes) truncate instead of stretching their
// column, so every 동산 block's table keeps the same fixed-layout width.
const CLIP = 'overflow-hidden text-ellipsis'
// **이름 · 예배 총 출석 두 열은 왼쪽에 고정된다** — 주일 열을 옆으로 넘겨도 누구의 줄인지,
// 그 사람이 몇 번 왔는지가 남는다. 두 번째 열은 첫 열의 폭만큼 떨어져 붙는다.
const STICKY_NAME = 'sticky left-0 z-[1]'
const STICKY_TOTAL = 'sticky left-[var(--name-col)] z-[1] shadow-[2px_0_0_rgba(0,0,0,0.08)]'
// 머리줄(이름 · 예배 총 출석 · 날짜)은 **그 동산 표의 위쪽에** 고정된다. 표마다 머리줄이 있고
// 고정 칸은 자기 표 안에서만 붙어 있으므로, 다음 동산 표가 올라오면 그 표의 머리줄이 자리를
// 이어받는다 — 동산마다 머리줄이 고정되는 셈이다. 그 위에는 동산 이름 띠가 먼저 붙는다.
const STICKY_HEAD = 'sticky top-[var(--band-h)] z-[2]'
// 이름 칸 안의 버튼 — 누르면 그 사람의 멤버 정보 창이 열린다 (`onOpenMember`가 있을 때만).
// 칸의 글자 모양(굵기·색)은 그대로 물려받고, 칸 폭을 넘는 이름은 칸과 똑같이 말줄임한다.
const NAME_BUTTON =
  'block w-full cursor-pointer truncate text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none'
const STICKY_HEAD_CORNER = 'sticky top-[var(--band-h)] z-[3]'
const DARK = '#1f2937'

// 열 너비(px) — 모든 동산 표가 같은 값을 쓰므로 표들의 너비가 정확히 같다: 이름 · 예배 총 출석
// · 날짜마다 하나. 날짜 칸은 헤더의 MM/DD/YYYY(시트와 같은 표기)가 이 글자 크기·좌우 여백에서
// 실제로 차지하는 만큼이다 — 이보다 좁게 적어 두면 표가 그 값을 지키지 못하고 저 혼자 넓어진다.
//
// **폰에서는 좁힌다** (sm 미만): 데스크톱 폭 그대로면 고정된 두 열(160 + 120)만으로 폰 화면이
// 거의 다 차서 주일 칸이 한 칸도 제대로 보이지 않았다. 폰에서는 날짜를 MM/DD로 줄이고 글자를
// 한 단계 작게 써서 세 칸이 고정 열 옆에 들어온다. 값은 CSS 변수로 표에 걸리므로 화면 폭이
// 바뀌어도 다시 그리지 않는다.
const COLS =
  '[--name-col:88px] [--total-col:52px] [--date-col:56px] ' +
  'sm:[--name-col:160px] sm:[--total-col:120px] sm:[--date-col:112px]'
// 동산 이름 띠의 높이 — 머리줄이 그만큼 아래에 붙는다.
const BAND = '[--band-h:2.5rem]'

// `table-layout: fixed`는 표의 너비가 정해져 있을 때만 colgroup의 값을 지킨다. 너비를
// 비워 두면 브라우저가 내용에 맞춰 다시 재므로, 긴 이름 하나가 그 블록의 이름 칸을 넓혀
// 셀마다 표 너비가 어긋났다 (칸이 서로 안 맞던 원인). 그래서 열 너비의 합을 표에 직접
// 적어 준다 — 모든 블록이 같은 수의 날짜 열을 그리므로 값도 하나로 같다.
function tableWidth(dates: number): string {
  return `calc(var(--name-col) + var(--total-col) + ${dates} * var(--date-col) + 1px)`
}

// **표를 그리는 자리는 하나다.** 출석부 탭이 쓰던 이 컴포넌트를 새가족 탭의 출석표도 그대로
// 쓴다 (`NewFamilySheetDialog`) — 같은 사실(누가 어느 주일에 왔나)을 두 화면이 각자 그리면
// 한쪽만 고쳐지고, 어느 쪽이 맞는지 알 수 없게 된다. 두 화면이 갈리는 것은 **누구를 담고
// 무엇으로 묶느냐** 둘뿐이라 `members`와 `groupBy`로 받는다.
export function AttendanceGrid({
  members,
  log,
  dongsanLog,
  lang,
  today,
  filter,
  semesterDates,
  sundays,
  groupBy,
  caption,
  fit = 'page',
  onOpenMember,
}: {
  members: Member[]
  log: LogEntry[]
  dongsanLog: LogEntry[]
  lang: Lang
  today: string
  filter: Filter
  semesterDates?: CalendarLike
  // 날짜 열. 비우면 그 부의 학기 주일(exportSundays) — 출석부가 그것이다. 새가족 출석표는
  // 학기가 열리기 전 주일까지 앞으로 늘려 받는다 (exports.ts newFamilySundays).
  sundays?: string[]
  // 블록을 가르는 기준. 비우면 출석부와 같은 동산(전환 기간에는 부서) 편성이다.
  groupBy?: (m: Member) => string
  // 표 위 한 줄. 비우면 출석부의 '학기 · 필터' 줄.
  caption?: string
  // 표가 스크롤되는 상자의 높이. 'page'(출석부 탭)는 헤더·칩 줄·아래 탭 막대를 뺀 화면
  // 높이이고, 'dialog'(새가족 출석표)는 창 안에 들어갈 만큼이다.
  fit?: 'page' | 'dialog'
  // 이름 칸을 눌렀을 때. 주면 이름이 버튼이 되어 그 사람의 멤버 정보 창을 연다 (출석부 탭).
  // 비우면 예전처럼 글자만 있다 — 새가족 출석표는 그 자체가 창이라 그 위에 창을 또 띄우지 않는다.
  onOpenMember?: (m: Member) => void
}) {
  const roleOf = useDongsanRole()
  const partition = usePartition()
  // 하위 단위를 뭐라 부르는지는 부서마다 다르다 — 대학·청년부는 동산·동산지기·부동산지기,
  // 장년부는 셀·셀장·부셀장 (lib/partition.ts unitTerms). 범례와 미지정 블록의 제목이 그것.
  const U = useUnitTerms(lang)
  const L =
    lang === 'ko'
      ? { name: '이름', memberTotal: '예배 총 출석', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', etc: '기타', leaderKey: U.leader, subleaderKey: U.subLeader, unassigned: U.unassigned, newFamily: '새가족', empty: '출석 기록이 없습니다', dongsanMeeting: `${U.unit}모임` }
      : { name: 'Name', memberTotal: 'Worship Total', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', etc: 'Other', leaderKey: U.leader, subleaderKey: U.subLeader, unassigned: U.unassigned, newFamily: 'New family', empty: 'No attendance records', dongsanMeeting: `${U.unit} meeting` }

  // 동산지기/부동산지기(셀장/부셀장) float to the top of their own block (roster order otherwise).
  const ordered = orderByDongsanRole(members, roleOf)
  const model = buildAttendanceModel(
    ordered,
    log,
    sundays ?? exportSundays(today, semesterDates, partition),
    today,
    { unassigned: L.unassigned, newFamily: L.newFamily },
    groupBy ?? attendanceGroupBy(today, semesterDates, L.unassigned, partition),
    dongsanLog,
  )
  const hasDongsan = dongsanLog.length > 0
  // 지기 색은 **그 표에 실제로 지기가 있을 때만** 범례에 오른다. 새가족 출석표에는 동산
  // 블록이 없어(부서로 묶는다) 아무 줄도 그 색으로 칠해지지 않는데, 범례만 남으면 표가
  // 쓰지 않는 색을 설명하게 된다 — 출석부에는 늘 지기가 있으므로 그쪽은 그대로다.
  const hasLeaders = ordered.some((m) => roleOf(m.name, m.group_name, m.subgroup || ''))
  const pink = cssColor(HEADER_TOTAL_FILL)
  const grey = cssColor(NOTE_FILL)

  if (model.sections.length === 0) return <p className="text-sm text-muted">{L.empty}</p>

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        {caption ?? `${semesterLabel(today, lang, semesterDates, partition)} · ${filterLabel(filter.group, filter.subgroup, lang)}`}
      </p>
      {/* Legend text uses theme tokens so it stays readable in dark mode; only the
          swatches keep the sheet's hardcoded paper palette. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-muted">
        <b className="rounded px-2.5 py-0.5 text-white" style={{ background: cssColor(KEY_FILL) }}>{L.key}</b>
        <span><b>O</b> {L.present}</span>
        <span><b>X</b> {L.absent}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: grey }} />
          {L.etc}
        </span>
        {/* 동산모임 표시는 시트 연동이 붙은 뒤에만 칸에 나타나므로, 범례도 그때만 보여준다. */}
        {hasDongsan && (
          <span className="inline-flex items-center gap-1">
            <b>O</b><sup className="text-[9px] font-bold opacity-70">O</sup>
            <span className="ml-0.5">{L.dongsanMeeting}</span>
          </span>
        )}
        {hasLeaders && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: '#FFF3C4' }} />
              <b>{L.leaderKey}</b>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: '#FFF9E1' }} />
              <b>{L.subleaderKey}</b>
            </span>
          </>
        )}
      </div>
      {/* **표는 상자 안에서 두 방향으로 스크롤된다** (`.grid-viewport`). 머리줄을 위에 붙여 두려면
          그 표가 세로로 스크롤되는 상자 안에 있어야 한다 — 가로 스크롤 상자(overflow-x)는 세로로도
          스크롤 상자가 되어 버려서, 페이지가 내려가는 동안 상자 안의 sticky는 붙을 자리가 없었다.
          상자의 높이는 화면에서 헤더 · 칩 줄 · 아래 탭 막대를 뺀 만큼이라, 상자 머리를 칩 줄 밑에
          맞추면 표 전체가 한 화면에 든다. 표의 끝에 닿으면 스크롤은 페이지로 이어진다 (세로는
          가두지 않는다 — 폰에서 손가락이 표 위에 있다고 페이지를 못 내리면 안 된다). 캡션과
          범례는 상자 밖이라 그대로 있다. */}
      <div
        className={`${fit === 'dialog' ? 'grid-viewport-dialog' : 'grid-viewport'} ${COLS} ${BAND} scroll-x overflow-y-auto rounded-sm text-xs sm:text-sm`}
        style={{ color: DARK }}
        data-testid="attendance-grid-viewport"
      >
        <div className="flex w-max flex-col gap-6 pb-1">
        {model.sections.map((s, si) => {
          const { light: lightArgb, medium: mediumArgb } = blockColors(si)
          const light = cssColor(lightArgb)
          const medium = cssColor(mediumArgb)
          return (
            <section key={s.subgroup}>
              {/* 동산 이름 띠 — 그 동산 표가 화면에 있는 동안 상자 맨 위에 붙어 있고, 이름표는
                  옆으로 넘겨도 왼쪽에 남는다. 머리줄만 고정하면 색으로만 어느 동산인지 짐작해야
                  한다. 띠는 바탕색이라 그 뒤로 지나가는 줄이 비치지 않는다. */}
              <div className="sticky top-0 z-[4] h-[var(--band-h)] bg-canvas">
                <h3 className="sticky left-0 inline-flex h-8 items-center rounded px-3 text-sm font-bold sm:text-base" style={{ background: medium, color: DARK }}>
                  {s.subgroup}
                </h3>
              </div>
              <table
                className="table-fixed border-separate border-spacing-0 border-l border-t border-[#b7b7b7] bg-white"
                style={{ width: tableWidth(model.dateLabels.length) }}
              >
                <colgroup>
                  <col style={{ width: 'var(--name-col)' }} />
                  <col style={{ width: 'var(--total-col)' }} />
                  {model.dateLabels.map((d) => (
                    <col key={d} style={{ width: 'var(--date-col)' }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${CELL} ${CLIP} ${STICKY_NAME} ${STICKY_HEAD_CORNER} text-left font-bold`} style={{ background: light }}>{L.name}</th>
                    {/* 폰에서는 이 칸이 좁아 '예배 총 출석'이 두 줄로 접힌다 (낱말 단위로). */}
                    <th
                      className={`${CELL} ${STICKY_TOTAL} ${STICKY_HEAD_CORNER} text-center font-bold leading-tight max-sm:whitespace-normal max-sm:break-keep`}
                      style={{ background: pink }}
                    >
                      {L.memberTotal}
                    </th>
                    {model.dateLabels.map((d) => (
                      <th key={d} className={`${CELL} ${STICKY_HEAD} text-center font-bold tabular-nums`} style={{ background: medium }}>
                        {/* MM/DD/YYYY → 폰에서는 MM/DD (해는 학기 줄에 이미 적혀 있다). */}
                        <span className="sm:hidden">{d.slice(0, 5)}</span>
                        <span className="max-sm:hidden">{d}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => {
                    const role = roleOf(r.member.name, r.member.group_name, r.member.subgroup || '')
                    const name = onOpenMember ? (
                      <button type="button" onClick={() => onOpenMember(r.member)} title={r.member.name} className={NAME_BUTTON}>
                        {r.member.name}
                      </button>
                    ) : (
                      r.member.name
                    )
                    return (
                    <tr key={r.member.id}>
                      {role ? (
                        // 동산지기 / 부동산지기: bold, warm-highlighted name cell (no icon). The
                        // grid is fixed light-scheme (hex fills) like the export, so hardcoded
                        // hex highlights are consistent here.
                        <td
                          className={`${CELL} ${CLIP} ${STICKY_NAME} text-left font-bold`}
                          style={{ background: role === '동산지기' ? '#FFF3C4' : '#FFF9E1' }}
                          title={r.member.name}
                        >
                          {name}
                        </td>
                      ) : (
                        <td className={`${CELL} ${CLIP} ${STICKY_NAME} bg-white text-left font-medium`} title={r.member.name}>{name}</td>
                      )}
                      <td className={`${CELL} ${STICKY_TOTAL} bg-white text-center font-bold`}>{r.total}</td>
                      {r.marks.map((c, di) => {
                        const d = model.dates[di]
                        // Status marks: one grey cell spanning the covered dates (master-sheet style).
                        if (c.kind === 'note')
                          return (
                            <td key={d} colSpan={c.span} className={`${CELL} ${CLIP} text-center`} style={{ background: grey }} title={c.note}>
                              {c.note}
                            </td>
                          )
                        if (c.kind === 'inNote') return null
                        // Pre-등록일자, upcoming Sundays and not-yet-entered dates render blank.
                        if (c.kind === 'blank') return <td key={d} className={`${CELL} bg-white`} />
                        const here = c.kind === 'present'
                        return (
                          <td
                            key={d}
                            className={`${CELL} bg-white text-center ${here ? 'font-bold text-[#16a34a]' : 'text-[#dc2626]'}`}
                          >
                            {here ? 'O' : 'X'}
                            {/* 동산모임은 예배와 다른 사실이라 같은 칸에 작게 덧붙는다 —
                                예배엔 못 왔지만 동산모임엔 온 주가 실제로 있다. 그날 동산모임을
                                아무도 적지 않았으면 아무것도 붙지 않는다. */}
                            {c.dongsan && (
                              <sup
                                className={`ml-0.5 text-[9px] font-bold ${c.dongsan === 'present' ? 'text-[#16a34a]' : 'text-[#dc2626]'} opacity-70`}
                                title={L.dongsanMeeting}
                              >
                                {c.dongsan === 'present' ? 'O' : 'X'}
                              </sup>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className={`${CELL} ${STICKY_NAME} text-left font-bold shadow-[2px_0_0_rgba(0,0,0,0.08)]`} style={{ background: medium }}>{L.total}</td>
                    {model.dates.map((d, i) => (
                      <td key={d} className={`${CELL} bg-white text-center font-bold`}>
                        {s.totals[i]}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </section>
          )
        })}
        </div>
      </div>
    </div>
  )
}
