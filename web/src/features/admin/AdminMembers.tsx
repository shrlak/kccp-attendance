import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { mergeMembers, bulkSetSubgroup, deleteMembers, getDongsanNames, type Member } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { Search, ListChecks, Merge as MergeIcon, Users, AlertTriangle, EyeOff, ChevronDown, Trash2, HandHeart, ArrowUpDown, SlidersHorizontal } from '../../components/ui/Icon'
import { mergeTargets, canMerge, mergeSummary, type MergeState } from './merge'
import {
  groupsOf, groupChipsOf, subgroupSectionsOf, matchesGroups, matchesSubgroups, matchesCareers, matchesSchools, pickChip,
  NO_GROUP, type CareerChip, type SchoolChip,
} from './filters'
import { Pill, PillTrack, SubgroupChips } from './GroupFilter'
import { TraitFilter } from './TraitFilter'
import { sortKeysFor, sortChipsOf, sortBlocks, matchesSortValues, sortValueLabel, type SortKey } from './memberSort'
import { readFilterDims, writeFilterDims, availableFilterDims, CARD_DIMS, type CardDim, type FilterDim } from './memberFilters'
import { MemberFilterPicker } from './MemberFilterPicker'
import { dongsanSectionsOf, flatDongsan } from './dongsan'
import { newFamilyWeek } from './newFamily'
import { NewFamilyWeekChip } from './NewFamilyWeekChip'
import { easternNow } from '../../lib/checkinWindow'
import { noteOn } from '../../lib/status'
import { IconKey } from './IconKey'
import { NewFamilyFacts } from './NewFamilyFacts'
import { KakaoTile } from './KakaoTile'
import { EditModal, AttendanceModal, Field } from './MemberDialogs'
import { resolveGroupColor, hexTint } from './groupColors'
import { refreshRoster } from '../../lib/live'
import { useAppConfig, usePartitionT } from '../../lib/useAppConfig'

// Members management: searchable card grid; tap a card to edit (scoped + read-only
// enforced server-side). Renaming, group/동산 changes (= transfer), role, new-member,
// and contact fields all go through PUT /api/admin/member.
export function AdminMembers() {
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useAppConfig()
  // 일괄 이동의 동산 목록은 설정된 동산 이름에서 온다 — 학기가 바뀌어 아무도 동산에
  // 속해 있지 않을 때도 새 학기 동산으로 여러 명을 한 번에 넣을 수 있어야 하므로.
  const { data: dongsanNames } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [merging, setMerging] = useState(false)
  const [search, setSearch] = useState('')
  // 칩 줄의 선택은 줄마다 **목록**이다 — 한 줄에서 칩을 여러 개 함께 고른다 (대학부 + 청년부,
  // 입교 + 세례). 빈 목록이 '전체'이고, 줄 안에서는 '또는', 줄과 줄 사이는 '그리고'다
  // (filters.ts `pickChip`). **동산과 학교만은 하나씩이다** (목록은 늘 비었거나 하나): 그 두
  // 줄이 묻는 것은 "이 동산(이 학교)은 누구누구인가"라, 둘을 섞어 놓으면 그 답이 흐려진다.
  //
  // 부서로 좁혀 보는 칩 (대학부 · 청년부 …) — 아래 섹션 머리줄이 이미 부서를 가르고 있지만
  // 그것은 **함께 놓고 보는** 자리라, 한 부서만 보려면 다른 부서를 지나 스크롤해야 했다.
  const [groups, setGroups] = useState<string[]>([])
  // 동산 칩 (호연선규 · 동산 미지정 …) — **고른 부서 안의 동산만** 내건다. 부서 줄이 명단을
  // 반으로 가르고 나면 그다음 물음이 늘 "그 부서 안에서 이 동산은 누구누구인가"인데, 여태는
  // 그 답을 출석부 탭(GroupFilter)으로 건너가야 볼 수 있었고 거기서는 카드가 아니라 출석
  // 칸이 나온다. 하나씩 고른다 (위).
  const [subgroups, setSubgroups] = useState<string[]>([])
  // 처지 칩 (대학원생 · 직장인 · 기타) — 청년부에서만 뜨고, 아래 학교 칩과 곱해진다
  // (청년부 대학원생 → CMU · Pitt).
  const [career, setCareer] = useState<CareerChip[]>([])
  // 학교로 좁혀 보는 칩 (CMU · Pitt · Duquesne · 기타) — **이 탭에만 있다.** 명단을 학교로
  // 갈라 보는 자리는 여기 하나이고, 출석부·통계·오늘이 세는 것은 그 주일에 누가 왔는가라
  // 학교는 그 질문의 칸이 아니다. 하나씩 고른다 (위).
  const [school, setSchool] = useState<SchoolChip[]>([])
  // 정렬 (성별 · 소속 · 세례여부 · 신앙생활 · 머물 기간 — 종이 등록 카드가 보기로 묻는 칸들 —
  // 과 새가족 · 새가족 교육 · 출생연도 · 등록 연도 · 목사님 심방 · 연락처). 부서 섹션 안에서
  // 값마다 묶음이 서고(memberSort.ts), **그 칸의 칩 줄이 위 고정 줄에 함께 선다** — 필터 창에서
  // 따로 켜지 않아도 된다 (`shown`). 묶음을 보다가 그중 하나만 남기는 일이 바로 이어지므로.
  const [sortKey, setSortKey] = useState<SortKey>('')
  // 칩 줄에 내걸 필터 — 사람이 고르고, 이 기기에 남는다 (memberFilters.ts). 고른 필터만
  // 칩 줄에 서고 그 줄에는 그 필터의 보기만 나온다.
  const [dims, setDims] = useState<FilterDim[]>(readFilterDims)
  const [pickerOpen, setPickerOpen] = useState(false)
  // 카드 필터의 값 (성별 '여' · 세례여부 '입교' + '세례' …). 줄끼리는 **곱해진다** — 여자이면서
  // 입교 또는 세례를 받은 사람.
  const [cardValues, setCardValues] = useState<Partial<Record<CardDim, string[]>>>({})
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  if (isLoading) return (
    <div className="fx-fade space-y-6">
      <div className="fx-skeleton h-11 rounded-xl" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {Array.from({ length: 12 }).map((_, i) => <div key={i} className="fx-skeleton h-20 rounded-2xl" />)}
      </div>
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
  const q = search.trim().toLowerCase()
  // 고를 수 있는 정렬은 그 칸을 읽어낼 수 있는 사람이 있는 칸뿐이다 (장년부에는 신앙생활 ·
  // 머물 기간이 없다). 부를 건너가 그 칸이 사라졌으면 이름순으로 돌아간다.
  const sortKeys = sortKeysFor([...data.members, ...data.hiddenMembers])
  const activeSort: SortKey = sortKey && sortKeys.includes(sortKey) ? sortKey : ''
  // 이름 검색과 학교 칩은 곱해진다 — 둘 다 "지금 보고 싶은 사람"을 좁히는 같은 종류의 도구라
  // 세 목록(명단·숨긴 멤버·스태프)에 똑같이 걸린다.
  const byName = (list: Member[]) =>
    (q ? list.filter((m) => m.name.toLowerCase().includes(q)) : list)
      .filter((m) => matchesGroups(m, groups))
      .filter((m) => matchesSubgroups(m, subgroups))
      .filter((m) => matchesCareers(m, career))
      .filter((m) => matchesSchools(m, school))
      .filter((m) => CARD_DIMS.every((d) => matchesSortValues(m, d, cardValues[d] ?? [])))
  // 칩 줄은 **위 줄에서 고른 것 안에서** 뽑는다 — 청년부 대학원생의 학교 칩은 그 사람들의
  // 학교여야 고른 뒤에 빈 화면이 나오지 않는다. 대신 위 줄을 고치면 아래 줄의 선택은
  // **비운다** (`pickGroups`/`pickCareer`): 사라진 칩으로 계속 좁히고 있으면 화면이 왜
  // 비었는지 알 수가 없다. 이름 검색만은 어느 줄에도 걸리지 않는다 — 검색어를 치는 동안
  // 칩이 사라졌다 나타나면 고를 수가 없다.
  const groupChips = groupChipsOf(data.members)
  const inGroup = data.members.filter((m) => matchesGroups(m, groups))
  // 동산 칩은 고른 부서 안에서 뽑고(청년부를 고르면 청년부 동산만), 처지·학교 줄은 그
  // **동산까지 좁혀진 뒤의** 명단에서 뽑는다 — 아래 줄의 칩은 늘 위에서 고른 것 안에 있다.
  // 동산 줄은 **부서마다 한 줄**로 갈린다 (subgroupSectionsOf) — 이름만 늘어놓으면 그 동산이
  // 청년부 것인지 대학부 것인지는 이름을 아는 사람만 안다. '동산 미지정'은 그 부서에 실제로
  // 편성이 안 된 사람이 있을 때만 (칩을 다 더하면 그 부서 전체가 되어야 한다).
  // 부서를 여러 개 골랐으면 그 부서들의 동산이 부서마다 한 줄씩 (이미 좁힌 명단에서 뽑는다).
  const subgroupSections = subgroupSectionsOf(inGroup, '')
  const hasUnassigned = inGroup.some((m) => !m.subgroup)
  const inSubgroup = inGroup.filter((m) => matchesSubgroups(m, subgroups))
  // 내걸 필터 = 사람이 고른 것 ∩ 이 명단에서 고를 것이 있는 것. 부를 건너가 사라진 필터는
  // 고른 채로 남아 있다가 돌아오면 다시 선다.
  // **정렬로 고른 칸은 켜지 않아도 선다** — 묶음으로 늘어놓은 값 중 하나만 남기려는 것이 바로
  // 다음 물음이라, 그 칩을 찾으러 필터 창을 다시 열게 하지 않는다. 정렬을 바꾸면 내려간다.
  const availableDims = availableFilterDims([...data.members, ...data.hiddenMembers])
  const shown = (d: FilterDim) => (dims.includes(d) || d === activeSort) && availableDims.includes(d)
  // 카드 필터의 칩은 **명단의 자리(부서 · 동산 · 학생/직장 · 학교)로 좁혀진 뒤의** 명단에서
  // 뽑는다 — 청년부만 보고 있으면 청년부에 실제로 있는 값만 나온다. 카드 필터끼리는 서로를
  // 좁히지 않는다 (서로 곱해지는 독립된 축이라, 한쪽을 고칠 때마다 다른 쪽 칩이 들고 나면 고를
  // 수가 없다). 위 줄을 바꿔도 고른 값은 **비우지 않고**, 그 값이 새 명단에 없으면 칩을 남겨
  // 둔다 — 화면이 왜 비었는지가 칩에 보이고, 누르면 풀린다.
  const inRoster = inSubgroup.filter((m) => matchesCareers(m, career) && matchesSchools(m, school))
  const cardChips = (d: CardDim) => {
    const chips = sortChipsOf(inRoster, d)
    const missing = (cardValues[d] ?? []).filter((v) => !chips.includes(v))
    return [...chips, ...missing]
  }
  // 단추의 숫자는 **걸려 있는 줄의 수**다 (칩 수가 아니다 — 입교 + 세례는 필터 하나).
  const activeFilters =
    [groups, subgroups, career, school].filter((l) => l.length > 0).length +
    CARD_DIMS.filter((d) => (cardValues[d]?.length ?? 0) > 0).length
  // useRoster has already taken the 숨긴 멤버 out of `data.members` — they are off the roster
  // everywhere in the app, and this tab is the one place they still surface: the 숨긴 멤버
  // section at the bottom. 지워진 게 아니라 접혀 있을 뿐이라, 카드를 눌러 표기를 풀거나
  // 종료일을 넣으면 바로 명단으로 돌아온다.
  const members = byName(data.members)
  const hiddenMembers = byName(data.hiddenMembers)
  const staffMembers = byName(data.staffMembers)
  const selectableMembers = [...data.members, ...data.hiddenMembers]
  const selectedMembers = selectableMembers.filter((m) => selected.has(m.id))
  // 일괄 이동 목록: 고른 멤버의 부서에 설정된 동산만 보여준다 — 대학부를 골랐으면 대학부
  // 동산, 청년부를 골랐으면 청년부 동산. 아직 아무도 안 골랐으면 양쪽을 다 보여주고,
  // 두 부서를 섞어 골랐으면 두 부서의 동산이 함께 나온다. 여름 모드는 합동 한 벌뿐.
  const selectedGroups = new Set(
    selectableMembers.filter((m) => selected.has(m.id)).map((m) => m.group_name).filter(Boolean),
  )
  const nameGroups = Object.keys(dongsanNames ?? {})
  const activeGroups = selectedGroups.size ? [...selectedGroups] : nameGroups
  // 드롭다운도 **부서마다 묶어서** 내건다 (optgroup) — 이미 그 부서 누군가가 속해 있는 동산은
  // 설정에서 빠졌더라도 함께 담긴다. 여름 합동처럼 두 부서가 같은 이름을 나눠 가지면
  // `dongsanSectionsOf`가 한 묶음으로 돌려주므로 여기서 여름 모드를 따로 볼 일이 없다.
  const dongsanGroups = dongsanSectionsOf(
    dongsanNames ?? {},
    activeGroups,
    selectableMembers.filter((m) => (selectedGroups.size ? selectedGroups.has(m.group_name) : true)),
  )
  const dongsanOptions = flatDongsan(dongsanGroups)

  // The card grid is split into one section per 부서 (대학부 first, then 청년부, …);
  // members without a 부서 gather in a trailing "—" section.
  const sections = [
    ...groupsOf(members).map((g) => ({ group: g, list: members.filter((m) => m.group_name === g) })),
    { group: '', list: members.filter((m) => !m.group_name) },
  ].filter((s) => s.list.length > 0)

  // 위 줄을 고르면 아래 줄은 처음으로 돌아간다 (부서 → 동산 → 처지 → 학교). 동산은 부서
  // 안에 있으므로 부서를 바꾸면 방금 고른 동산은 그 부서에 있지도 않고, 축이 부서마다
  // 다르므로 (청년부는 처지, 그 밖은 학교) 남겨 두면 청년부에서 고른 '대학원생'이 대학부
  // 에서도 계속 걸린 채로 남는다.
  function pickGroups(next: string[]) {
    setGroups(next)
    setSubgroups([])
    setCareer([])
    setSchool([])
  }
  function pickSubgroups(next: string[]) {
    setSubgroups(next)
    setCareer([])
    setSchool([])
  }
  function pickCareer(next: CareerChip[]) {
    setCareer(next)
    setSchool([])
  }
  function pickCard(d: CardDim, next: string[]) {
    setCardValues((cur) => ({ ...cur, [d]: next }))
  }
  // 필터를 칩 줄에서 내리면 **그 필터로 좁혀 둔 것도 푼다** — 보이지 않는 칩이 명단을 계속
  // 좁히고 있으면 화면이 왜 비었는지 알 길이 없다.
  function clearDim(d: FilterDim) {
    if (d === 'group') setGroups([])
    else if (d === 'subgroup') setSubgroups([])
    else if (d === 'career') setCareer([])
    else if (d === 'school') setSchool([])
    else pickCard(d, [])
  }
  function chooseFilters(next: FilterDim[]) {
    // 정렬로 서 있는 줄은 필터를 꺼도 그대로 보이므로 그 선택도 그대로 둔다.
    for (const d of dims) if (!next.includes(d) && d !== activeSort) clearDim(d)
    setDims(next)
    writeFilterDims(next)
  }
  // 정렬을 바꾸면 정렬 때문에 서 있던 줄은 내려간다 — 그 줄로 좁혀 둔 것도 같이 푼다
  // (chooseFilters와 같은 규칙: 보이지 않는 칩이 명단을 좁히고 있으면 안 된다).
  function chooseSort(next: SortKey) {
    if (activeSort && activeSort !== next && !dims.includes(activeSort)) clearDim(activeSort)
    setSortKey(next)
  }

  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    // 부서가 달라지면 고른 동산이 더 이상 후보가 아닐 수 있다 — 그때는 비운다.
    setTarget((cur) => (cur && !dongsanOptions.includes(cur) ? '' : cur))
  }
  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
    setTarget('')
  }
  async function applyBulk(subgroup: string) {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await bulkSetSubgroup([...selected], subgroup)
      toast({ title: t('admin.members.bulkMove.done', { n: res.updated }), tone: 'ok' })
      refreshRoster(qc)
      exitSelect()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBulkBusy(false)
    }
  }
  async function applyBulkDelete() {
    if (selectedMembers.length === 0) return
    setBulkBusy(true)
    try {
      const res = await deleteMembers(selectedMembers.map((m) => m.id))
      toast({ title: t('admin.members.bulkDelete.done', { n: res.deleted }), tone: 'ok' })
      refreshRoster(qc)
      setConfirmBulkDelete(false)
      exitSelect()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <>
      {/* 검색 · 동산 이동 · 병합 **그리고 부서·동산 칩**은 명단을 한참 내려가도 계속 손이
          닿아야 한다 — 아래에서 사람을 고르다가 이동시키려고, 또 동산을 바꿔 보려고 매번 맨
          위로 되돌아가지 않도록 패널 헤더 바로 밑에 붙여 둔다 (엑셀의 행 고정과 같은 뜻).
          카드가 이 줄 뒤로 지나가므로 배경은 불투명해야 하고, 좌우 여백만큼 늘려서(-mx/px)
          카드가 가장자리로 비어져 나오지 않게 한다. 높이는 화면의 40%까지만 — 고정은 명단을
          보면서 고르라고 두는 것이라 명단이 안 보이면 뜻이 없다 (넘치면 이 줄 안에서 스크롤). */}
      <div className="sticky top-[var(--admin-header-h,4.5rem)] z-10 -mx-[var(--gutter)] mb-5 flex max-h-[40vh] flex-col gap-3 overflow-y-auto border-b border-separator bg-canvas px-[var(--gutter)] pb-3 pt-1">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[7rem] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.members.search')}
            aria-label={t('admin.members.search')}
            className="pl-10"
          />
        </div>
        {(data.canBulkSubgroup || data.role !== 'pastor') && (
          <Button
            variant="secondary"
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            aria-label={selectMode ? undefined : t('admin.members.selection.action')}
          >
            <ListChecks className="size-4" aria-hidden />
            {/* 폰에서는 '선택' 두 글자 — 검색 칸과 한 줄에 서야 고정 줄이 한 줄 덜 먹는다. */}
            {selectMode ? (
              t('common.cancel')
            ) : (
              <>
                <span className="max-sm:hidden">{t('admin.members.selection.action')}</span>
                <span className="sm:hidden">{t('admin.members.selection.short')}</span>
              </>
            )}
          </Button>
        )}
        {!selectMode && (
          <Button variant="secondary" onClick={() => setMerging(true)} disabled={data.members.length < 2}>
            <MergeIcon className="size-4" aria-hidden />
            {t('admin.members.merge.action')}
          </Button>
        )}
      </div>
      {/* 선택 모드의 이동 줄도 같이 붙어 있어야 쓸모가 있다 — 아래에서 체크하고 바로 옮긴다. */}
      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3 shadow-[var(--shadow-sm)]">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
            <ListChecks className="size-4" aria-hidden />
            {t('admin.members.bulkMove.selected', { n: selected.size })}
          </span>
          {data.canBulkSubgroup && (
            <>
              <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-[8rem] flex-1">
                <option value="">{t('admin.members.bulkMove.placeholder')}</option>
                {dongsanGroups.map((section) =>
                  // 묶음이 하나뿐이면(부서가 하나인 부, 여름 합동) 이름표가 늘 같은 값이라
                  // 아무것도 말해 주지 않으므로 그냥 평평하게 둔다.
                  dongsanGroups.length > 1 && section.group ? (
                    <optgroup key={section.group} label={section.group}>
                      {section.list.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    section.list.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))
                  ),
                )}
              </Select>
              <Button size="sm" disabled={selected.size === 0 || !target || bulkBusy} onClick={() => applyBulk(target)}>
                {t('admin.members.bulkMove.moveTo')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => applyBulk('')}
              >
                {t('admin.members.bulkMove.remove')}
              </Button>
            </>
          )}
          {data.role !== 'pastor' && (
            <Button size="sm" variant="danger" disabled={selected.size === 0 || bulkBusy} onClick={() => setConfirmBulkDelete(true)}>
              <Trash2 className="size-4" aria-hidden />
              {t('admin.members.bulkDelete.action')}
            </Button>
          )}
        </div>
      )}
      {/* 칩 줄 — **사람이 고른 필터만** 선다 (맨 앞의 '필터' 단추 → MemberFilterPicker), 그리고
          정렬로 고른 칸 하나. 열다섯 줄을 다 늘어놓으면 폰에서 이 고정 줄이 화면을 덮고, 이번에
          가를 한두 줄을 찾으려고 나머지를 지나가야 했다. 차례는 고정이다: 명단의 자리(부서 → 동산
          → 학생/직장 → 학교, 위를 고르면 아래가 비워지는 사슬)가 먼저, 등록 카드의 보기와 그 밖의
          정보(서로 곱해지는 독립된 축)가 그 뒤. 줄마다 칩은 여러 개를 함께 고른다 — 동산과 학교만
          하나씩이다. 단추의 숫자는 지금 걸려 있는 줄의 수다. */}
      <div className="flex flex-wrap items-start gap-2">
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-3.5 text-xs font-semibold text-text shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:border-primary/30 hover:bg-surface-alt active:scale-[0.96]"
      >
        <SlidersHorizontal className="size-4 text-subtle" aria-hidden />
        {t('admin.members.filters.action')}
        {activeFilters > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-fg">
            {activeFilters}
          </span>
        )}
      </button>
      {/* 부서 칩 — 한 부서만 놓고 보는 자리다. 아래 섹션 머리줄은 부서를 가르되 **함께**
          보여주므로, 대학부만 훑으려면 청년부를 지나 내려가야 했다. */}
      {shown('group') && groupChips.length > 1 && (
        <PillTrack label={t('admin.members.group')}>
          <Pill active={groups.length === 0} onClick={() => pickGroups([])}>
            {t('admin.filter.all')}
          </Pill>
          {groupChips.map((g) => (
            <Pill key={g} active={groups.includes(g)} onClick={() => pickGroups(pickChip(groups, g, true))}>
              {g === NO_GROUP ? t('admin.members.noGroup') : g}
            </Pill>
          ))}
        </PillTrack>
      )}
      {/* 동산 칩 — 부서마다 갈린다: 한 트랙 안에서 청년부 동산은 청년부 이름표 뒤에, 대학부
          동산은 대학부 이름표 뒤에. 그리는 자리는 하나라 (SubgroupChips) 오늘·출석부·새가족
          탭의 같은 줄과 어긋나지 않는다. 고를 것이 하나뿐이면 트랙 자체가 뜨지 않는다. 동산은
          하나씩 고른다 — 누르면 그 동산 하나로 바뀐다. */}
      {shown('subgroup') && (
        <SubgroupChips sections={subgroupSections} value={subgroups} onChange={pickSubgroups} noneChip={hasUnassigned} />
      )}
      {/* 학생/직장 · 학교 트랙 — 새가족 탭과 **같은 컴포넌트**다 (TraitFilter). 두 탭이 같은
          명단을 다르게 가르면 '대학부 CMU'가 탭마다 다른 사람들을 뜻하게 된다. 여기서는 둘을
          따로 켜고 끈다. 학생/직장은 여러 개를 함께, 학교는 하나씩 고른다. */}
      <TraitFilter
        members={inSubgroup}
        groups={groups}
        career={career}
        school={school}
        onCareer={pickCareer}
        onSchool={setSchool}
        showCareer={shown('career')}
        showSchool={shown('school')}
        multiCareer
      />
      {/* 등록 카드의 보기 — 성별 · 소속 · 세례여부 · 신앙생활 · 머물 기간 — 와 그 밖의 정보
          (새가족 · 새가족 교육 · 출생연도 · 등록 연도 · 목사님 심방 · 연락처). 세례여부는 여러 개를
          고를 수 있는 칸이라 '입교'는 '유아세례, 입교'로 적힌 사람도 데려온다 (그래서 이 줄만은
          칩의 인원을 더하면 전체보다 클 수 있다). 칩은 여러 개를 함께 누른다 (입교 + 세례). */}
      {CARD_DIMS.filter(shown).map((d) => {
        const chips = cardChips(d)
        if (chips.length === 0) return null
        const value = cardValues[d] ?? []
        return (
          <PillTrack key={d} label={t(`admin.members.sort.keys.${d}`)}>
            <span className="section-kicker shrink-0 whitespace-nowrap pl-2 pr-1">{t(`admin.members.sort.keys.${d}`)}</span>
            <Pill active={value.length === 0} onClick={() => pickCard(d, [])}>
              {t('admin.filter.all')}
            </Pill>
            {chips.map((v) => (
              <Pill key={v} active={value.includes(v)} onClick={() => pickCard(d, pickChip(value, v, true))}>
                {sortValueLabel(t, d, v)}
              </Pill>
            ))}
          </PillTrack>
        )
      })}
      </div>
      </div>
      {/* 명단 머리줄 — 인원 옆, 오른쪽에 **정렬**이 선다. 정렬은 목록을 어떻게 늘어놓을지를
          한 번 정하는 자리라 칩 줄처럼 화면을 따라다닐 필요가 없고, 고정 줄에 두면 폰에서 그만큼
          명단이 가려진다 (값으로 좁히는 칩만 고정 줄에 붙는다). 폰에서 누르면 기기의 선택 창이
          뜬다. 고를 칸이 하나도 없는 부에서는 뜨지 않는다. */}
      {(!selectMode || sortKeys.length > 0) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {!selectMode ? (
            <div className="flex items-center gap-2 section-kicker">
              <Users className="size-4 text-subtle" aria-hidden />
              {t('admin.nav.members')} · {members.length}
            </div>
          ) : (
            <span />
          )}
          {sortKeys.length > 0 && (
            <div className="relative w-[9.5rem] shrink-0 sm:w-44">
              <ArrowUpDown className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <Select
                value={activeSort}
                onChange={(e) => chooseSort(e.target.value as SortKey)}
                aria-label={t('admin.members.sort.label')}
                className="pl-10"
              >
                <option value="">{t('admin.members.sort.name')}</option>
                {sortKeys.map((k) => (
                  <option key={k} value={k}>
                    {t(`admin.members.sort.keys.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}
      <IconKey items={['newMemberStar', 'eduWeek1', 'eduWeek2']} />
      {sections.map(({ group, list }) => {
        // 대학부/청년부 cards get a faint per-부서 tint (configurable in 관리자 › 설정);
        // every other section (EM, staff-ish groups, no 부서) stays the plain surface.
        const tint = group === '대학부' || group === '청년부' ? hexTint(resolveGroupColor(cfg?.groupColors, group), 0.07) : undefined
        return (
        <section key={group || 'none'} className="mb-8 fx-rise">
          <h3 className="mb-3 flex items-center gap-2 border-b border-separator pb-2.5 font-display text-lg font-bold tracking-tight text-text">
            {group || '—'}
            <span className="rounded-full bg-fill px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">{list.length}</span>
          </h3>
          {/* 정렬을 고르면 부서 섹션 **안에서** 값마다 묶음이 선다 (대학부 › 남 · 여 · 미기재).
              부서를 넘어 섞지 않는 것은 섹션 머리줄이 이미 부서를 가르고 있어서다 — 그 줄을
              지우면 같은 화면에서 부서가 사라진다. 이름순이면 묶음이 하나뿐이라 머리줄이 없다. */}
          {sortBlocks(list, activeSort).map((block) => (
            <div key={block.value || 'all'} className={activeSort ? 'mb-4 last:mb-0' : undefined}>
              {activeSort && (
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
                  <span className="min-w-0 break-words">{sortValueLabel(t, activeSort, block.value)}</span>
                  <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{block.list.length}</span>
                </h4>
              )}
              {/* 한 줄에 여섯 명까지 — 새가족 탭의 카드 격자와 같은 폭이다. 카드가 전화·학교/
                  직장·세례여부까지 담게 된 뒤로 여덟 칸은 그 값들을 한 글자도 못 읽게 만든다. */}
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {block.list.map((m) => (
                  <MemberCard
                    key={m.id}
                    member={m}
                    today={today}
                    tint={tint}
                    selectMode={selectMode}
                    selected={selected.has(m.id)}
                    onOpen={() => (selectMode ? toggleSel(m.id) : setEditing(m))}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
        )
      })}
      {hiddenMembers.length > 0 && (
        <section className="mt-8 border-t border-separator pt-5">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-text"
          >
            <EyeOff className="size-4" aria-hidden />
            {t('admin.members.hidden.title')}
            <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{hiddenMembers.length}</span>
            <ChevronDown className={'size-4 transition-transform duration-200 ' + (showHidden ? 'rotate-180' : '')} aria-hidden />
          </button>
          {showHidden && (
            <>
              <p className="mt-2 text-xs text-muted">{t('admin.members.hidden.desc')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {hiddenMembers.map((m) => {
                  const sel = selectMode && selected.has(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => (selectMode ? toggleSel(m.id) : setEditing(m))}
                      className={
                        'min-h-20 rounded-2xl border p-3.5 text-left shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform,opacity] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-primary/30 hover:opacity-100 hover:shadow-[var(--shadow)] active:translate-y-0 ' +
                        (sel ? 'border-primary bg-surface ring-2 ring-primary/40' : 'border-border bg-surface-2 opacity-80')
                      }
                    >
                      <div className="leading-snug">
                        {selectMode && (
                          <span className={'mr-2 inline-grid h-4 w-4 place-items-center rounded-full align-middle text-[10px] font-bold ' + (sel ? 'bg-primary text-primary-fg' : 'border border-border text-transparent')}>
                            ✓
                          </span>
                        )}
                        <span className="break-words text-base font-semibold text-text">{m.name}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted">{m.group_name || '—'}</div>
                      <span className="mt-1.5 inline-block whitespace-nowrap rounded-full bg-warning/12 px-2 py-0.5 text-[10px] font-semibold text-warning">
                        {noteOn(m, today) ?? ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </section>
      )}
      {staffMembers.length > 0 && (
        <>
          <div className="mb-3 mt-6 flex items-center gap-2 section-kicker">
            {t('admin.members.staffSection')}
            <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{staffMembers.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {staffMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditing(m)}
                className="min-h-20 rounded-2xl border border-border bg-surface p-3.5 text-left shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow)] active:translate-y-0"
              >
                <div className="text-base font-semibold text-text">{m.name}</div>
                <div className="mt-1 text-xs text-muted">{m.member_role || '—'}</div>
              </button>
            ))}
          </div>
        </>
      )}
      {editing && (
        <EditModal
          member={editing}
          allowDelete={data.role !== 'pastor'}
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
          readOnly={data.role === 'pastor'}
          onClose={() => setAttendanceFor(null)}
        />
      )}
      {confirmBulkDelete && (
        <Dialog
          open
          onOpenChange={(open) => !open && !bulkBusy && setConfirmBulkDelete(false)}
          title={t('admin.members.bulkDelete.title', { n: selectedMembers.length })}
        >
          <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4">
            <p className="flex items-start gap-2 text-sm font-semibold text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('admin.members.bulkDelete.warn')}</span>
            </p>
            <div className="mt-3 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {selectedMembers.map((m) => (
                <span key={m.id} className="rounded-full border border-danger/20 bg-surface px-2.5 py-1 text-xs font-semibold text-text">
                  {m.name}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmBulkDelete(false)} disabled={bulkBusy} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={applyBulkDelete} disabled={bulkBusy} className="flex-1">
              {bulkBusy ? t('common.loading') : t('admin.members.bulkDelete.confirm', { n: selectedMembers.length })}
            </Button>
          </div>
        </Dialog>
      )}
      {merging && <MergeModal members={data.members} onClose={() => setMerging(false)} />}
      {pickerOpen && (
        <MemberFilterPicker
          members={[...data.members, ...data.hiddenMembers]}
          available={availableDims}
          value={dims}
          sortDim={activeSort}
          onChange={chooseFilters}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

// 멤버 카드 — **새가족 탭의 카드와 같은 것을 보여준다**: 이름 · 부서·동산 · 역할 · 전화 ·
// 학교/직장·세례여부·신앙생활(NewFamilyFacts) · 카톡 아이디(KakaoTile). 여태 이 탭의 카드는
// 이름과 부서·동산 두 줄뿐이라, 전화번호 하나를 보려고 사람마다 편집 창을 열었다 — 같은
// 사람의 같은 사실이 새가족 탭에서는 카드에 그대로 적혀 있는데도.
//
// 세 칸과 카톡 타일은 **두 탭이 같은 컴포넌트를 쓴다** (NewFamilyFacts · KakaoTile): 같은
// 사실을 두 화면이 각자 그리면 한쪽만 고쳐지고 어느 쪽이 맞는지 알 수 없게 된다.
//
// 카드가 버튼 하나였다가 `li` 안의 버튼이 된 이유는 카톡 타일이다 — 복사 버튼은 카드를 여는
// 버튼 밖에 있어야 하고(버튼 안의 버튼은 성립하지 않는다), 그래서 테두리·색·선택 링은 바깥
// `li`가 들고 있다. 여러 명 선택 중에는 타일을 내린다: 그때 카드가 하는 일은 고르는 것
// 하나뿐이라, 탭이 복사로 빠지면 고른 줄 알았던 사람이 안 고쳐져 있다.
function MemberCard({
  member: m,
  today,
  tint,
  selectMode,
  selected,
  onOpen,
}: {
  member: Member
  today: string
  tint: string | undefined
  selectMode: boolean
  selected: boolean
  onOpen: () => void
}) {
  const t = usePartitionT()
  const sel = selectMode && selected
  const week = newFamilyWeek(m.registration_date, today)

  return (
    <li
      style={sel ? undefined : { background: tint }}
      className={
        'min-h-20 rounded-2xl border p-3.5 shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow)] active:translate-y-0 ' +
        (sel ? 'border-primary bg-surface ring-2 ring-primary/40' : 'border-border' + (tint ? '' : ' bg-surface'))
      }
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="leading-snug">
          {selectMode && (
            <span className={'mr-2 inline-grid h-4 w-4 place-items-center rounded-full align-middle text-[10px] font-bold ' + (sel ? 'bg-primary text-primary-fg' : 'border border-border text-transparent')}>
              ✓
            </span>
          )}
          <span className="break-words text-base font-semibold text-text">{m.name}</span>
          {/* 목사님 심방 요청 — 새가족 카드와 같은 아이콘, 같은 자리. */}
          {m.pastoral_visit_requested && (
            <HandHeart className="ml-1 inline size-3.5 align-middle text-primary" aria-label={t('admin.newfamily.pastoralVisit')} />
          )}
          {m.is_new_member && (
            <>
            {/* 이번 주일 / 지난주에 등록한 새가족은 새가족 탭과 같은 색으로 구분하고,
                그보다 오래된 새가족은 기존 새가족 배지를 그대로 단다. */}
            {week === 'thisWeek' || week === 'lastWeek' ? (
              <NewFamilyWeekChip week={week} className="ml-1.5 px-2 py-0.5 align-middle text-[10px]" />
            ) : (
              <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-gold/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-gold">
                {t('admin.iconKey.newMemberStar')}
              </span>
            )}
            {m.new_member_edu_week1 && (
              <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-info/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-info">
                {t('admin.iconKey.eduWeek1')}
              </span>
            )}
            {m.new_member_edu_week2 && (
              <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-info/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-info">
                {t('admin.iconKey.eduWeek2')}
              </span>
            )}
            </>
          )}
        </div>
        <div className="mt-1 text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}</div>
        {m.member_role && <div className="mt-1 text-[11px] font-medium text-subtle">{m.member_role}</div>}
        {/* 빈 칸은 줄을 만들지 않는다 — 없는 것을 '—'로 적어 두면 카드만 길어진다
            (NewFamilyFacts와 같은 규칙). */}
        {m.phone && <div className="mt-1 text-xs text-subtle">{m.phone}</div>}
        <NewFamilyFacts member={m} />
      </button>
      {!selectMode && <KakaoTile member={m} />}
    </li>
  )
}

function MergeModal({ members, onClose }: { members: Member[]; onClose: () => void }) {
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  const [s, setS] = useState<MergeState>({ fromId: '', toId: '' })
  const [saving, setSaving] = useState(false)

  const sorted = mergeTargets(members, '') // all members, by name — the source picker
  const targets = mergeTargets(members, s.fromId) // everyone except the chosen source

  async function submit() {
    if (!canMerge(s)) return
    setSaving(true)
    try {
      await mergeMembers(s.fromId, s.toId)
      refreshRoster(qc)
      toast({ title: t('admin.members.merge.done'), tone: 'ok' })
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.members.merge.title')}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t('admin.members.merge.help')}</p>
        <Field label={t('admin.members.merge.from')}>
          <Select value={s.fromId} onChange={(e) => setS({ fromId: e.target.value, toId: '' })}>
            <option value="">—</option>
            {sorted.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.members.merge.to')}>
          <Select value={s.toId} onChange={(e) => setS((cur) => ({ ...cur, toId: e.target.value }))} disabled={!s.fromId}>
            <option value="">—</option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {canMerge(s) && (
          <p className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('admin.members.merge.warn', { summary: mergeSummary(members, s) })}</span>
          </p>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={submit} disabled={!canMerge(s) || saving} className="flex-1">
          {saving ? t('common.loading') : t('admin.members.merge.confirm')}
        </Button>
      </div>
    </Dialog>
  )
}
