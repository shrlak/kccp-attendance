import { useTranslation } from 'react-i18next'
import { Tag } from '../../components/ui/Tag'
import type { Member } from '../../lib/api'

// 새가족 카드에 붙는 세 가지 사실 — **학교/직장 · 세례여부 · 신앙생활**.
// 종이 카드가 묻는 칸들이고 새가족팀이 그 사람을 어떻게 맞을지가 거기서 갈리는데,
// 여태는 사람마다 편집 창을 열어야만 보였다.
//
// **그리는 자리는 하나다**: 새가족 탭과 새가족 교육 탭이 같은 컴포넌트를 쓴다. 같은 사실을
// 두 화면이 각자 그리면 한쪽만 고쳐지고 어느 쪽이 맞는지 알 수 없게 된다 (AttendanceGrid를
// 두 화면이 함께 쓰는 것과 같은 규칙).
//
// **값은 적힌 그대로 보여준다** — 카드의 보기(유아세례 · 1-3년)가 곧 저장되는 말이고,
// 학교/직장 칸은 애초에 자유 기입란이라('대학생 · CMU Math' · '피츠버그 대학교 화학공학과')
// 다듬으면 그 칸에 뭐가 있었는지가 사라진다. 언어를 따르는 것은 라벨뿐이다. 좁은 카드에서
// 긴 값은 잘리므로 title에 원문을 남긴다 — 잘린 자리에서 값을 잃지 않는다.
//
// **빈 칸은 줄을 만들지 않는다**: 없는 것을 '—'로 적어 두면 카드만 길어진다.
export function NewFamilyFacts({ member }: { member: Member }) {
  const { t } = useTranslation()
  const facts: { key: string; label: string; value: string }[] = [
    { key: 'school', label: t('admin.newfamily.school'), value: (member.school_or_work || '').trim() },
    { key: 'baptism', label: t('admin.newfamily.baptism'), value: (member.baptism_status || '').trim() },
    { key: 'faith', label: t('admin.newfamily.faith'), value: (member.faith_duration || '').trim() },
  ].filter((f) => f.value.length > 0)
  if (facts.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {facts.map((f) => (
        <Tag key={f.key} className="max-w-full text-[10px]" title={`${f.label} ${f.value}`}>
          <span className="shrink-0 font-normal text-subtle">{f.label}</span>
          <span className="truncate">{f.value}</span>
        </Tag>
      ))}
    </div>
  )
}
