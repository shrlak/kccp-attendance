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
const CELL = 'whitespace-nowrap border border-[#b7b7b7] px-3 py-1.5'
// Variable-length cells (names, status notes) truncate instead of stretching their
// column, so every 동산 block's table keeps the same fixed-layout width.
const CLIP = 'overflow-hidden text-ellipsis'
// The 이름 column is pinned to the left edge of the horizontal scroll. `border-collapse`
// doesn't repaint a sticky cell's own right border reliably, so the column's separating
// edge is drawn as a box-shadow instead.
const STICKY_NAME = 'sticky left-0 z-[1] shadow-[1px_0_0_#b7b7b7]'
const DARK = '#1f2937'

// Fixed column widths (px), shared by every 동산 block so all tables end up the exact
// same overall width regardless of name/label lengths: 이름 · 예배 총 출석 · one per date.
// 날짜 칸은 헤더의 MM/DD/YYYY(시트와 같은 표기)가 이 글자 크기·좌우 여백에서 실제로
// 차지하는 만큼이다 — 이보다 좁게 적어 두면 표가 그 값을 지키지 못하고 저 혼자 넓어진다.
const NAME_COL = 160
const TOTAL_COL = 120
const DATE_COL = 112

// `table-layout: fixed`는 표의 너비가 정해져 있을 때만 colgroup의 값을 지킨다. 너비를
// 비워 두면 브라우저가 내용에 맞춰 다시 재므로, 긴 이름 하나가 그 블록의 이름 칸을 넓혀
// 셀마다 표 너비가 어긋났다 (칸이 서로 안 맞던 원인). 그래서 열 너비의 합을 표에 직접
// 적어 준다 — 모든 블록이 같은 수의 날짜 열을 그리므로 값도 하나로 같다.
function tableWidth(dates: number): number {
  return NAME_COL + TOTAL_COL + dates * DATE_COL
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
      {/* Only the tables scroll sideways — the caption and legend above stay put, where
          before they were dragged along inside the scroll area and slid off screen on a
          phone. The 이름 column is pinned so a row stays identifiable once the Sunday
          columns are scrolled past it. */}
      <div className="scroll-x flex flex-col gap-6 text-sm" style={{ color: DARK }}>
        {model.sections.map((s, si) => {
          const { light: lightArgb, medium: mediumArgb } = blockColors(si)
          const light = cssColor(lightArgb)
          const medium = cssColor(mediumArgb)
          return (
            <section key={s.subgroup} className="w-max">
              <h3 className="mb-1.5 inline-block rounded px-3 py-1 text-base font-bold" style={{ background: medium, color: DARK }}>
                {s.subgroup}
              </h3>
              <table className="table-fixed border-collapse bg-white" style={{ width: tableWidth(model.dateLabels.length) }}>
                <colgroup>
                  <col style={{ width: NAME_COL }} />
                  <col style={{ width: TOTAL_COL }} />
                  {model.dateLabels.map((d) => (
                    <col key={d} style={{ width: DATE_COL }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${CELL} ${CLIP} ${STICKY_NAME} text-left font-bold`} style={{ background: light }}>{L.name}</th>
                    <th className={`${CELL} text-center font-bold`} style={{ background: pink }}>{L.memberTotal}</th>
                    {model.dateLabels.map((d) => (
                      <th key={d} className={`${CELL} text-center font-bold`} style={{ background: medium }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => {
                    const role = roleOf(r.member.name, r.member.group_name, r.member.subgroup || '')
                    return (
                    <tr key={r.member.id}>
                      {role ? (
                        // 동산지기 / 부동산지기: bold, warm-highlighted name cell (no icon). The
                        // grid is fixed light-scheme (hex fills) like the export, so hardcoded
                        // hex highlights are consistent here.
                        <td
                          className={`${CELL} ${CLIP} ${STICKY_NAME} text-left font-bold`}
                          style={{ background: role === '동산지기' ? '#FFF3C4' : '#FFF9E1' }}
                        >
                          {r.member.name}
                        </td>
                      ) : (
                        <td className={`${CELL} ${CLIP} ${STICKY_NAME} bg-white text-left font-medium`}>{r.member.name}</td>
                      )}
                      <td className={`${CELL} bg-white text-center font-bold`}>{r.total}</td>
                      {r.marks.map((c, di) => {
                        const d = model.dates[di]
                        // Status marks: one grey cell spanning the covered dates (master-sheet style).
                        if (c.kind === 'note')
                          return (
                            <td key={d} colSpan={c.span} className={`${CELL} ${CLIP} text-center`} style={{ background: grey }}>
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
                    <td colSpan={2} className={`${CELL} ${STICKY_NAME} text-left font-bold`} style={{ background: medium }}>{L.total}</td>
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
  )
}
