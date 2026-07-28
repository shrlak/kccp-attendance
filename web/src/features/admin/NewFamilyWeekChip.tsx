import { useTranslation } from 'react-i18next'
import type { NewFamilyWeek } from './newFamily'

// 이번 주일 등록 / 지난주 등록 chip — the 주일 cohort a 새가족 (or a whole 등록일 group)
// belongs to. Brand fill for this 주일's registrations, gold for the previous week's, so
// the two read apart at a glance; anything older carries no chip since its 등록일 already
// says so. `count` turns it into a summary chip ("이번 주일 등록 3").
export function NewFamilyWeekChip({ week, count }: { week: NewFamilyWeek | null; count?: number }) {
  const { t } = useTranslation()
  if (week !== 'thisWeek' && week !== 'lastWeek') return null
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
        (week === 'thisWeek' ? 'bg-primary text-white' : 'bg-gold/15 text-gold')
      }
    >
      {t(`admin.newfamily.week.${week}`)}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  )
}
