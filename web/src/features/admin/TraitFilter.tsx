import { useTranslation } from 'react-i18next'
import type { Member } from '../../lib/api'
import { Pill } from './GroupFilter'
import {
  careersOf, matchesCareer, schoolsOf, careerAxis, schoolAxis,
  type CareerFilter, type SchoolFilter,
} from './filters'
import { SCHOOL_NAMES } from './eduDongsanTraits'
import { Briefcase, GraduationCap } from '../../components/ui/Icon'

// 처지(대학원생 · 직장인 · 기타) · 학교(CMU · Pitt · Duquesne · 기타) 두 줄 — **멤버 탭과
// 새가족 탭이 같은 이 컴포넌트를 쓴다.** 두 탭이 같은 명단을 다르게 가르면 대학부에서
// 'CMU'가 어느 탭에서는 다른 사람들을 뜻하게 된다.
//
// 부서 줄은 여기 없다: 멤버 탭은 자기 칩 줄로, 새가족 탭은 부서·동산 `GroupFilter`로 이미
// 부서를 고르고 있어서, 이 컴포넌트가 받는 `members`는 **그 부서로 좁혀진 뒤의 명단**이다.
// 축이 부서마다 다른 규칙(`careerAxis`/`schoolAxis`)은 filters.ts 하나에만 산다.
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
  // 아래 줄의 칩은 **위에서 고른 것 안에서** 뽑는다 — 청년부 대학원생의 학교 칩은 그
  // 사람들의 학교여야 고른 뒤에 빈 화면이 나오지 않는다.
  const careerChips = careerAxis(group) ? careersOf(members) : []
  const inCareer = members.filter((m) => matchesCareer(m, career))
  const schools = schoolAxis(group, career) ? schoolsOf(inCareer) : []
  // 고를 것이 없으면 줄이 없다: 학교를 하나도 읽어내지 못한 부(장년부)에는 '기타' 하나만
  // 남는데, 그 칩은 전체와 같은 묶음이라 고를 뜻이 없다.
  const showCareers = careerChips.length > 1
  const showSchools = schools.length > 1 && schools.some((s) => s !== 'none')
  if (!showCareers && !showSchools) return null

  return (
    <>
      {/* 처지 칩 — 청년부의 가름이다. 그 부서는 대학원생과 직장인이 반씩이라 학교 하나로는
          갈리지 않고, 직장인에게 학교는 지금 어디에 있는지를 말해 주지 않는다. */}
      {showCareers && (
        <div role="group" aria-label={t('admin.members.careerFilter')} className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <Briefcase className="mr-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <Pill active={!career} onClick={() => onCareer('')}>
            {t('admin.filter.all')}
          </Pill>
          {careerChips.map((c) => (
            <Pill key={c} active={career === c} onClick={() => onCareer(c)}>
              {t(`admin.members.career.${c}`)}
            </Pill>
          ))}
        </div>
      )}
      {/* 학교 칩 — 위 줄과 곱해지는 다른 가름이다 (대학부 안의 CMU, 청년부 대학원생 안의
          Pitt). 청년부에서는 대학원생을 고른 뒤에만 뜬다. */}
      {showSchools && (
        <div role="group" aria-label={t('admin.members.schoolFilter')} className="mb-4 flex flex-wrap items-center gap-1.5">
          <GraduationCap className="mr-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <Pill active={!school} onClick={() => onSchool('')}>
            {t('admin.filter.all')}
          </Pill>
          {schools.map((s) => (
            <Pill key={s} active={school === s} onClick={() => onSchool(s)}>
              {s === 'none' ? t('admin.members.school.none') : SCHOOL_NAMES[s]}
            </Pill>
          ))}
        </div>
      )}
    </>
  )
}
