import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDongsanBoard, markDongsan, type DongsanBoard, type DongsanBoardMember } from '../../lib/api'
import { hasHidingMark } from '../../lib/status'
import { KccpMark } from '../checkin/KccpMark'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'

// ── /dongsan/:token — 부서 담당자가 그 부서의 동산모임 출석을 적는 화면 ───────────
// 로그인이 없다. 링크가 신원이고, 그 링크는 부서 하나를 가리킨다 — 이 화면으로 볼 수 있는
// 것은 그 부서 사람들의 이름과 그들의 **동산모임** 출석뿐이다. 예배 출석도, 연락처도, 다른
// 부서도 여기서는 보이지 않는다 (서버 /api/dongsan/board가 그만큼만 내려준다).
//
// 왜 O/X 둘뿐인가: 표에서 출석은 "줄이 있다/없다"이고, 없는 줄은 "안 왔다"와 "아직 안 적었다"를
// 구별하지 않는다. 시트 연동에서는 그 구별이 중요했지만(빈칸을 결석으로 읽으면 안 되니까),
// 여기서는 적는 사람이 곧 그 부서의 담당자라 X가 곧 "안 왔다"이다. 다만 한 주일에 O가 하나도
// 없으면 아직 손대지 않은 주일일 수 있으므로, 그 주는 화면이 따로 알려 준다.
export function DongsanBoardScreen() {
  const { token = '' } = useParams()
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [date, setDate] = useState<string | null>(null)

  const key = ['dongsanBoard', token]
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => getDongsanBoard(token),
    enabled: !!token,
    retry: false,
  })

  // 서버가 정한 주일 목록의 마지막이 이번 주다. 리더가 다른 주를 고르면 그 선택이 이긴다.
  const week = date ?? data?.dates[data.dates.length - 1] ?? ''
  const ctx = data?.partition === 'adult' ? 'adult' : undefined

  // 귀국·이주처럼 명단에서 빠진 사람은 리더 화면에도 뜨지 않는다 — 앱 전체가 쓰는 그 규칙을
  // 그대로 쓴다 (lib/status.ts가 그 규칙의 단 하나뿐인 독자다).
  const members = useMemo(
    () => (data?.members ?? []).filter((m) => !hasHidingMark(statusOf(m))),
    [data?.members],
  )
  const marks = useMemo(() => new Set(data?.marks ?? []), [data?.marks])
  const presentCount = members.filter((m) => marks.has(`${m.id}|${week}`)).length

  // 링크 하나가 부서 하나를 담으므로 화면은 동산별로 묶어 그린다 — 이름만 30줄 늘어놓으면
  // 적는 사람이 자기 줄을 못 찾는다. 동산이 아직 없는 사람은 '동산 미지정' 블록에 모인다
  // (편성 전에도 이 링크로 적을 수 있어야 한다). 서버가 이미 동산 → 이름 순으로 정렬해 보낸다.
  const blocks = useMemo(() => {
    const out: { subgroup: string; members: typeof members }[] = []
    for (const m of members) {
      const last = out[out.length - 1]
      if (last && last.subgroup === m.subgroup) last.members.push(m)
      else out.push({ subgroup: m.subgroup, members: [m] })
    }
    return out
  }, [members])

  const mark = useMutation({
    mutationFn: ({ memberId, present }: { memberId: string; present: boolean }) =>
      markDongsan(token, memberId, week, present),
    // 탭이 화면에 바로 남는다 — 왕복을 기다리면 드롭다운이 되돌아갔다가 다시 바뀐다.
    onMutate: async ({ memberId, present }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<DongsanBoard>(key)
      if (prev) {
        const cell = `${memberId}|${week}`
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
        <div className="safe-x mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3">
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
                <p className="truncate text-[11px] text-muted">{t('dongsan.title', { context: ctx })}</p>
              )}
            </div>
          </div>
          <ThemeLangToggle />
        </div>
      </header>

      <div className="safe-x mx-auto w-full max-w-2xl grow px-4 py-5">
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
            <label className="block">
              <span className="field-label">{t('dongsan.week')}</span>
              <Select value={week} onChange={(e) => setDate(e.target.value)}>
                {[...data.dates].reverse().map((d) => (
                  <option key={d} value={d}>
                    {formatSunday(d, i18n.language)}
                  </option>
                ))}
              </Select>
            </label>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-text">
                {t('dongsan.count', { n: presentCount, total: members.length })}
              </span>
              {presentCount === 0 && members.length > 0 && (
                <span className="text-xs text-muted">{t('dongsan.emptyWeek')}</span>
              )}
            </div>

            {!members.length && (
              <div className="inset-list mt-2">
                <div className="inset-row min-h-14 text-sm text-muted">{t('dongsan.noMembers', { context: ctx })}</div>
              </div>
            )}
            {blocks.map((block) => (
              <div key={block.subgroup} className="mt-2">
                <span className="section-kicker mb-1 mt-3 block">
                  {block.subgroup || t('dongsan.noSubgroup', { context: ctx })}
                </span>
                <div className="inset-list">
                  {block.members.map((m) => {
                    const present = marks.has(`${m.id}|${week}`)
                    return (
                      <div key={m.id} className="inset-row min-h-14 items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0 truncate text-sm font-semibold text-text">{m.name}</span>
                        <Select
                          className="!w-28 shrink-0"
                          aria-label={m.name}
                          value={present ? 'O' : 'X'}
                          onChange={(e) => mark.mutate({ memberId: m.id, present: e.target.value === 'O' })}
                        >
                          <option value="O">{t('dongsan.present')}</option>
                          <option value="X">{t('dongsan.absent')}</option>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            <p className="mt-4 text-xs text-muted">{t('dongsan.hint', { context: ctx })}</p>
          </>
        )}
      </div>
    </main>
  )
}

// 서버는 표에 있는 그대로 — 비어 있으면 null — 을 실어 보내고, status.ts는 Member의 모양
// (비어 있으면 없는 칸)을 읽는다. 그 한 칸 차이를 여기서 맞춘다. 표기를 읽는 규칙 자체는
// 여전히 status.ts 하나뿐이고, 여기서 하는 일은 모양을 맞춰 넘기는 것뿐이다.
function statusOf(m: DongsanBoardMember) {
  return {
    status_note: m.status_note ?? undefined,
    status_start: m.status_start ?? null,
    status_end: m.status_end ?? null,
    status_marks: m.status_marks ?? undefined,
  }
}

// 2026-08-09 → "8월 9일 (주일)" / "Sun, Aug 9". 날짜 문자열은 자정 UTC로 읽히면 하루 밀리므로
// 정오를 붙여 읽는다 (앱의 다른 날짜 표시와 같은 방식).
function formatSunday(iso: string, lang: string) {
  const at = new Date(iso + 'T12:00:00')
  return at.toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
}
