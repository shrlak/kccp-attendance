import { useTranslation } from 'react-i18next'
import type { Member } from '../../lib/api'
import { Pill, PillTrack } from './GroupFilter'
import { traitChips, type CareerFilter, type SchoolFilter } from './filters'
import { SCHOOL_NAMES } from './eduDongsanTraits'
import { Briefcase, GraduationCap } from '../../components/ui/Icon'

// 처지(대학원생 · 직장인 · 기타) · 학교(CMU · Pitt · Duquesne · 기타) 두 줄 — **멤버 탭과
// 새가족 탭이 같은 이 컴포넌트를 쓴다.** 두 탭이 같은 명단을 다르게 가르면 대학부에서
// 'CMU'가 어느 탭에서는 다른 사람들을 뜻하게 된다.
//
// 부서 줄은 여기 없다: 멤버 탭은 자기 칩 줄로, 새가족 탭은 부서·동산 `GroupFilter`로 이미
// 부서를 고르고 있어서, 이 컴포넌트가 받는 `members`는 **그 부서로 좁혀진 뒤의 명단**이다.
// 축이 부서마다 다른 규칙(`careerAxis`/`schoolAxis`)은 filters.ts 하나에만 산다.
//
// **감싸는 줄 없이 트랙만 내놓는다** — 부서·동산 트랙이 선 그 줄(패널 헤더 밑에 붙어
// 스크롤을 따라오는 칩 줄)에 이어 흐르라는 것이다. 예전에는 이 두 줄이 그 고정 줄 **밑**에
// 따로 서 있어서, 명단을 내려가면 부서·동산은 따라오는데 학교만 화면 밖으로 사라졌다 —
// 위에서 아래로 좁혀 가는 한 벌의 칩인데 그중 마지막 줄만 손이 닿지 않았다.
export function TraitFilter({
  members,
  group,
  career,
  school,
  onCareer,
  onSchool,
}: {
  members: Member[] // 이미 부서로 좁혀진 명단
  group: string // 고른 부서 ('' = 전체) — 어느 축을 내걸지가 여기서 갈린다
  career: CareerFilter
  school: SchoolFilter
  onCareer: (c: CareerFilter) => void // 처지를 고치면 학교 선택은 부르는 쪽이 비운다
  onSchool: (s: SchoolFilter) => void
}) {
  const { t } = useTranslation()
  const { careers: careerChips, schools } = traitChips(members, group, career)
  if (careerChips.length === 0 && schools.length === 0) return null

  return (
    <>
      {/* 처지 칩 — 청년부의 가름이다. 그 부서는 대학원생과 직장인이 반씩이라 학교 하나로는
          갈리지 않는다. 뒤의 학교 트랙과 **곱해진다**: 대학원생을 고르면 학교 칩이 그 사람들의
          학교로 좁혀져, 청년부 대학원생을 CMU · Pitt으로 가르는 자리가 된다. */}
      {careerChips.length > 0 && (
        <PillTrack label={t('admin.members.careerFilter')}>
          <Briefcase className="mx-1.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <Pill active={!career} onClick={() => onCareer('')}>
            {t('admin.filter.all')}
          </Pill>
          {careerChips.map((c) => (
            <Pill key={c} active={career === c} onClick={() => onCareer(c)}>
              {t(`admin.members.career.${c}`)}
            </Pill>
          ))}
        </PillTrack>
      )}
      {/* 학교 칩 — 앞 트랙과 곱해지는 다른 가름이다 (대학부 안의 CMU, 청년부 대학원생 안의
          Pitt). 청년부에서는 **직장인을 고른 동안에만** 내려간다 — 그 사람에게 학교는 지금
          어디에 있는지를 말해 주지 않는다. */}
      {schools.length > 0 && (
        <PillTrack label={t('admin.members.schoolFilter')}>
          <GraduationCap className="mx-1.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <Pill active={!school} onClick={() => onSchool('')}>
            {t('admin.filter.all')}
          </Pill>
          {schools.map((s) => (
            <Pill key={s} active={school === s} onClick={() => onSchool(s)}>
              {s === 'none' ? t('admin.members.school.none') : SCHOOL_NAMES[s]}
            </Pill>
          ))}
        </PillTrack>
      )}
    </>
  )
}
