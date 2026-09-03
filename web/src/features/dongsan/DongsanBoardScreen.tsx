import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDongsanBoard, markDongsan, type DongsanBoard } from '../../lib/api'
import { ABSENT_INK, blockColors, cssColor, LEADER_FILL, PAPER_INK, PRESENT_INK, SUBLEADER_FILL } from '../../lib/sheetPalette'
import { boardBlocks, currentColumn, type BoardBlock } from './board'
import { KccpMark } from '../checkin/KccpMark'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'
import { useToast } from '../../components/ui/Toast'

// ── /dongsan/:token — 부서 담당자가 그 부서의 동산모임 출석을 적는 화면 ───────────
// 로그인이 없다. 링크가 신원이고, 그 링크는 부서 하나를 가리킨다 — 이 화면으로 볼 수 있는
// 것은 그 부서 사람들의 이름과 그들의 **동산모임** 출석뿐이다. 예배 출석도, 연락처도, 다른
// 부서도 여기서는 보이지 않는다 (서버 /api/dongsan/board가 그만큼만 내려준다).
//
// **출석부와 같은 종이다**: 관리자 출석부 탭(AdminSheet의 GridView)과 내보내는 엑셀이 쓰는
// 그 색·그 칸선·그 자리 잡기를 그대로 쓴다 (lib/sheetPalette.ts). 이 표에 적히는 것이 결국
// 그 출석부에 나타나므로, 두 종이가 달라 보이면 옮겨 적을 때 눈이 미끄러진다 — 동산지기·
// 부동산지기가 블록 맨 위에 노란 칸으로 앉아 있는 것도 거기서 온 것이다. 그래서 이 표만은
// 화면 테마를 따르지 않는다 (감싸는 화면은 따른다).
//
// **표 한 장이 한 학기다**: 서버가 이번 학기의 주일을 통째로 내려주므로(boardSundays) 아직
// 오지 않은 주일도 칸으로 나와 있고, 사람이 주마다 채운다. 그래서 열이 열다섯을 넘고, 위의
// 동산 고르기와 '이번 주' 표시가 그 넓이를 감당하는 두 장치다.
//
// 왜 O/X 둘뿐인가: 표에서 출석은 "줄이 있다/없다"이고, 없는 줄은 "안 왔다"와 "아직 안 적었다"를
// 구별하지 않는다. 시트 연동에서는 그 구별이 중요했지만(빈칸을 결석으로 읽으면 안 되니까),
// 여기서는 적는 사람이 곧 그 부서의 담당자라 X가 곧 "안 왔다"이다. 다만 아직 손대지 않은 주일도
// X로 보이므로, 각 열의 **합계**를 함께 두어 0인 열이 눈에 띄게 했다.
export function DongsanBoardScreen() {
  const { token = '' } = useParams()
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const key = ['dongsanBoard', token]
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => getDongsanBoard(token),
    enabled: !!token,
    retry: false,
  })

  const ctx = data?.partition === 'adult' ? 'adult' : undefined

  // 동산으로 묶고, 지기를 블록 맨 위로 올리고, 명단에서 빠진 사람과 동산 미지정을 걷어내는
  // 일은 전부 board.ts가 한다 (순수 함수라 테스트가 붙는다).
  const blocks = useMemo(() => boardBlocks({ members: data?.members ?? [], leaders: data?.leaders }), [data])
  const marks = useMemo(() => new Set(data?.marks ?? []), [data?.marks])
  const dates = data?.dates ?? []
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const now = currentColumn(dates, today)

  // 위에서 동산을 고른다. 학기 한 장이 통째로 놓이는 표라 부서 전체를 한 번에 그리면 세로로도
  // 길어지는데, 실제로 적을 때는 한 동산씩 훑는다. 고른 것이 사라지지 않도록(동산 이름이
  // 바뀌거나 배정이 비면) 목록에 없는 값은 '전체'로 되돌린다.
  const [only, setOnly] = useState('')
  const picked = blocks.some((b) => b.subgroup === only) ? only : ''
  const shown = picked ? blocks.filter((b) => b.subgroup === picked) : blocks

  const mark = useMutation({
    mutationFn: ({ memberId, date, present }: { memberId: string; date: string; present: boolean }) =>
      markDongsan(token, memberId, date, present),
    // 고른 값이 화면에 바로 남는다 — 왕복을 기다리면 드롭다운이 되돌아갔다가 다시 바뀐다.
    onMutate: async ({ memberId, date, present }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<DongsanBoard>(key)
      if (prev) {
        const cell = `${memberId}|${date}`
        qc.setQueryData<DongsanBoard>(key, {
          ...prev,
          marks: present ? [...prev.marks.filter((c) => c !== cell), cell] : prev.marks.filter((c) => c !== cell),
        })
      }
      return { prev }
    },
    onError: (_e, _v, context) => {
      if (context?.prev) qc.setQueryData(key, context.prev)
      toast({ title: t('dongsan.saveFailed'), tone: 'err' })
    },
  })

  return (
    <main className="relative flex min-h-dvh flex-col bg-canvas">
      <header className="material-bar sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)]">
        <div className="safe-x mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <KccpMark size={28} className="shrink-0" />
            <div className="min-w-0">
              {/* 이 링크가 어느 부서의 것인지가 제목이다 ('대학부 전체'). 열자마자 자기 것이
                  맞는지 알아야 남의 부서에 적지 않는다. */}
              <h1 className="truncate font-display text-base font-bold tracking-tight text-text">
                {!data
                  ? t('dongsan.title', { context: ctx })
                  : t('dongsan.wholeGroup', { group: data.group })}
              </h1>
              {data && (
                <p className="truncate text-[11px] text-muted">
                  {t('dongsan.title', { context: ctx })}
                  {/* 이 표가 덮는 기간 — 학기 한 장이므로 양 끝이 곧 학기의 처음과 끝이다. */}
                  {dates.length > 0 && ` · ${shortSunday(dates[0])} – ${shortSunday(dates[dates.length - 1])}`}
                </p>
              )}
            </div>
          </div>
          <ThemeLangToggle />
        </div>
      </header>

      <div className="safe-x mx-auto w-full max-w-5xl grow px-4 py-5">
        {isLoading && <p className="text-sm text-muted">{t('common.loading')}</p>}

        {/* 폐기된 링크·오타 난 주소는 여기로 온다. 무엇이 잘못됐는지만 말하고 끝낸다 —
            이 화면에는 로그인도, 다시 시도할 다른 길도 없다. */}
        {!isLoading && (error || !data) && (
          <div className="surface-panel p-5 text-center">
            <p className="text-sm font-semibold text-text">{t('dongsan.gone')}</p>
            <p className="mt-1 text-xs text-muted">{t('dongsan.goneHint', { context: ctx })}</p>
          </div>
        )}

        {data && (
          <>
            {blocks.length > 1 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-subtle">{t('dongsan.pick', { context: ctx })}</span>
                <div className="segmented flex-wrap">
                  <PickChip active={!picked} onClick={() => setOnly('')}>{t('dongsan.all')}</PickChip>
                  {blocks.map((b) => (
                    <PickChip key={b.subgroup} active={picked === b.subgroup} onClick={() => setOnly(b.subgroup)}>
                      {b.subgroup}
                    </PickChip>
                  ))}
                </div>
              </div>
            )}

            {!blocks.length ? (
              <div className="inset-list">
                <div className="inset-row min-h-14 text-sm text-muted">{t('dongsan.noMembers', { context: ctx })}</div>
              </div>
            ) : (
              <>
                <Legend ctx={ctx} />
                {shown.map((block) => (
                  <DongsanTable
                    key={block.subgroup}
                    block={block}
                    color={blockColors(blocks.indexOf(block))}
                    dates={dates}
                    now={now}
                    marks={marks}
                    ctx={ctx}
                    onPick={(memberId, date, present) => mark.mutate({ memberId, date, present })}
                  />
                ))}
              </>
            )}

            <p className="mt-5 text-xs text-muted">{t('dongsan.hint', { context: ctx })}</p>
            <p className="mt-1 text-xs text-muted">{t('dongsan.blankNote')}</p>
            {/* 표에 없는 사람은 세어서 적어 둔다 — 안 적으면 "그 사람은 왜 없지"의 답이
                화면 어디에도 없다. 배정은 관리자의 동산 탭이 한다. */}
            {!!data.unassigned && (
              <p className="mt-1 text-xs text-muted">
                {t('dongsan.unassignedNote', { n: data.unassigned, context: ctx })}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function PickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'min-h-9 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        (active ? 'bg-surface text-primary shadow-[var(--shadow-sm)]' : 'text-muted hover:text-text')
      }
    >
      {children}
    </button>
  )
}

// 칸 색이 무슨 뜻인지 — 출석부 탭의 범례와 같은 말, 같은 색.
function Legend({ ctx }: { ctx?: 'adult' }) {
  const { t } = useTranslation()
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      <span><b style={{ color: PRESENT_INK }}>O</b> {t('dongsan.present')}</span>
      <span><b style={{ color: ABSENT_INK }}>X</b> {t('dongsan.absent')}</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded-sm border border-border" style={{ background: LEADER_FILL }} />
        <b>{t('dongsan.leader', { context: ctx })}</b>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded-sm border border-border" style={{ background: SUBLEADER_FILL }} />
        <b>{t('dongsan.subLeader', { context: ctx })}</b>
      </span>
    </div>
  )
}

// 스프레드시트의 칸. 출석부 탭(AdminSheet)의 CELL/STICKY_NAME과 같은 값이다 — 같은 표의
// 다른 자리이므로 칸선도 같아야 한다. border-collapse는 고정된(sticky) 칸의 오른쪽 선을
// 제대로 다시 그리지 않아, 이름 열의 경계선만 box-shadow로 그린다.
// (칸선 #b7b7b7 = sheetPalette의 GRID_LINE, '이번 주' 테두리 #1f2937 = PAPER_INK. 여기서는
// 값을 글자 그대로 적는다 — Tailwind는 소스에 **적혀 있는** 클래스 이름만 보므로 상수를 끼워
// 넣어 만든 이름은 스타일이 아예 만들어지지 않는다.)
const CELL = 'whitespace-nowrap border border-[#b7b7b7] px-2 py-1'
const CLIP = 'overflow-hidden text-ellipsis'
const STICKY_NAME = 'sticky left-0 z-[1] shadow-[1px_0_0_#b7b7b7]'
// '이번 주' 열의 세로 테두리 — 스프레드시트에서 열 하나를 고른 그 모양이다. 칸 색을 바꾸지
// 않는 이유는 그 자리가 이미 지기의 노란색을 담고 있기 때문(색을 겹치면 둘 다 뜻을 잃는다).
const NOW_COL = 'shadow-[inset_1px_0_0_#1f2937,inset_-1px_0_0_#1f2937]'
const NOW_COL_TOP = 'shadow-[inset_1px_0_0_#1f2937,inset_-1px_0_0_#1f2937,inset_0_2px_0_#1f2937]'
const NOW_COL_BOTTOM = 'shadow-[inset_1px_0_0_#1f2937,inset_-1px_0_0_#1f2937,inset_0_-2px_0_#1f2937]'
// 열 너비(px). 표가 table-fixed라 합계를 표 너비로 직접 적어 주어야 브라우저가 내용에 맞춰
// 제멋대로 다시 재지 않는다 (긴 이름 하나가 그 블록만 넓히던 일이 출석부 탭에서 실제로 있었다).
const NAME_COL = 116
const TOTAL_COL = 64
const DATE_COL = 62

// 한 동산의 표. 세로가 사람, 가로가 학기의 주일. 이름 열은 왼쪽에 고정하고 나머지를 가로로
// 굴린다 — 폰에서는 학기 한 장이 한 화면에 들어가지 않는다.
function DongsanTable({
  block,
  color,
  dates,
  now,
  marks,
  ctx,
  onPick,
}: {
  block: BoardBlock
  color: { light: string; medium: string }
  dates: string[]
  /** 지금이 어느 열인가 — 그 열만 진한 테두리로 짚어 준다. */
  now: string
  marks: Set<string>
  ctx?: 'adult'
  onPick: (memberId: string, date: string, present: boolean) => void
}) {
  const { t } = useTranslation()
  const light = cssColor(color.light)
  const medium = cssColor(color.medium)
  const scroller = useRef<HTMLDivElement>(null)
  const placed = useRef(false)

  // 열자마자 '이번 주' 열이 보이는 자리로 굴려 둔다. 9월에 열었는데 표가 12월에 가 있거나
  // (혹은 12월에 열었는데 9월에 머물러 있거나) 하면 적기 전에 매번 찾아 굴려야 한다.
  // 한 번만 한다 — 적는 동안 화면이 저 혼자 움직이면 고르던 칸을 놓친다.
  useEffect(() => {
    const el = scroller.current
    const i = dates.indexOf(now)
    if (!el || placed.current || i < 0) return
    el.scrollLeft = Math.max(0, NAME_COL + TOTAL_COL + i * DATE_COL - el.clientWidth / 2)
    placed.current = true
  }, [dates, now])

  return (
    <section className="mt-5 first:mt-0" style={{ color: PAPER_INK }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="inline-block rounded px-3 py-1 text-base font-bold" style={{ background: medium }}>
          {block.subgroup}
        </h2>
        {/* 지기는 블록 맨 위 줄로도 앉지만, 이름은 여기에도 적는다 — 편성표에는 있는데 명단
            에는 없는 지기(부서가 어긋난 경우가 실제로 있다)는 표에 줄이 없기 때문. */}
        {block.leader && (
          <span className="text-xs font-semibold text-muted">
            {t('dongsan.leader', { context: ctx })} <b className="text-text">{block.leader}</b>
          </span>
        )}
        {block.subLeaders.length > 0 && (
          <span className="text-xs font-semibold text-muted">
            {t('dongsan.subLeader', { context: ctx })} <b className="text-text">{block.subLeaders.join(', ')}</b>
          </span>
        )}
      </div>

      <div ref={scroller} className="scroll-x rounded-sm border border-border">
        <table className="table-fixed border-collapse bg-white text-sm" style={{ width: NAME_COL + TOTAL_COL + dates.length * DATE_COL }}>
          <colgroup>
            <col style={{ width: NAME_COL }} />
            <col style={{ width: TOTAL_COL }} />
            {dates.map((d) => (
              <col key={d} style={{ width: DATE_COL }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${CELL} ${CLIP} ${STICKY_NAME} text-left text-xs font-bold`} style={{ background: light }}>
                {t('dongsan.name')}
              </th>
              <th scope="col" className={`${CELL} text-center text-xs font-bold`} style={{ background: light }}>
                {t('dongsan.memberTotal')}
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  scope="col"
                  aria-current={d === now ? 'date' : undefined}
                  className={`${CELL} text-center text-xs font-bold ${d === now ? NOW_COL_TOP : ''}`}
                  style={{ background: medium }}
                >
                  {shortSunday(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map(({ member, role }) => {
              const total = dates.filter((d) => marks.has(`${member.id}|${d}`)).length
              const fill = role === '동산지기' ? LEADER_FILL : role === '부동산지기' ? SUBLEADER_FILL : undefined
              return (
                <tr key={member.id}>
                  <th
                    scope="row"
                    className={`${CELL} ${CLIP} ${STICKY_NAME} text-left text-sm ${role ? 'font-bold' : 'font-medium'}`}
                    style={{ background: fill ?? '#fff' }}
                  >
                    {member.name}
                  </th>
                  <td className={`${CELL} bg-white text-center text-sm font-bold tabular-nums`}>{total}</td>
                  {dates.map((d) => {
                    const present = marks.has(`${member.id}|${d}`)
                    return (
                      <td key={d} className={`${CELL} bg-white p-0 text-center ${d === now ? NOW_COL : ''}`}>
                        {/* 아직 오지 않은 주일은 빈 칸이다 — 열리지도 않은 모임에 결석이 있을 수
                            없는데, O/X 둘뿐인 드롭다운은 빈 칸을 담지 못해 온 학기가 X로 덮여
                            보인다 (관리자 출석부도 앞으로 올 주일은 비워 둔다). 칸은 미리 나
                            있고, 그 주가 오면 열린다. */}
                        {d > now ? (
                          <div className="h-9" />
                        ) : (
                          /* 칸마다 드롭다운. 네이티브 select라 폰에서 손가락으로 고르기 쉽고,
                             O/X 둘뿐이라 고르는 동안 헷갈릴 것이 없다. 칸선과 색은 td가 그리고
                             select는 그 안을 채우기만 한다 — 그래야 표가 표로 읽힌다. */
                          <select
                            aria-label={`${member.name} ${d}`}
                            value={present ? 'O' : 'X'}
                            onChange={(e) => onPick(member.id, d, e.target.value === 'O')}
                            className="h-9 w-full cursor-pointer appearance-none border-0 bg-transparent text-center text-sm font-bold outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#1a73e8]"
                            style={{ color: present ? PRESENT_INK : ABSENT_INK }}
                          >
                            <option value="O">O</option>
                            <option value="X">X</option>
                          </select>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          {/* 합계 — 아직 손대지 않은 주일은 0으로 드러난다 (그 열은 전부 X로 보이므로). */}
          <tfoot>
            <tr>
              <th scope="row" className={`${CELL} ${CLIP} ${STICKY_NAME} text-left text-xs font-bold`} style={{ background: light }}>
                {t('dongsan.total')}
              </th>
              <td className={`${CELL} text-center text-sm font-bold tabular-nums`} style={{ background: light }}>
                {block.rows.reduce((n, r) => n + dates.filter((d) => marks.has(`${r.member.id}|${d}`)).length, 0)}
              </td>
              {dates.map((d) => {
                const n = block.rows.filter((r) => marks.has(`${r.member.id}|${d}`)).length
                return (
                  <td
                    key={d}
                    className={`${CELL} bg-white text-center text-sm font-bold tabular-nums ${d === now ? NOW_COL_BOTTOM : ''}`}
                    style={{ color: n ? PAPER_INK : '#9aa0a6' }}
                  >
                    {d > now ? '' : n}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

// 2026-08-09 → "8/9". 열이 열다섯 개를 넘으므로 머리글은 짧아야 하고, 그 안에서 주일끼리
// 구별만 되면 된다. toLocaleDateString을 쓰지 않는 이유는 ko-KR이 "8. 9."로 점을 찍어 좁은
// 칸에서 지저분해지기 때문이고, 어차피 월/일 두 숫자라 언어에 따라 달라질 것이 없다.
// 문자열에서 바로 자르므로 자정 UTC로 읽혀 하루 밀리는 일도 없다.
function shortSunday(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}
