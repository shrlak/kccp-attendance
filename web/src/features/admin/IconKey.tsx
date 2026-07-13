import { useTranslation } from 'react-i18next'

export type IconKeyItem = 'newFamily' | 'visitor' | 'firstVisit' | 'newMemberStar'

// Compact status legend shared by roster and attendance views.
export function IconKey({ items }: { items: IconKeyItem[] }) {
  const { t } = useTranslation()
  return (
    <div className="mb-4 flex flex-wrap gap-1.5" aria-label={t('admin.iconKey.legend')}>
      {items.map((item) => (
        <span key={item} className="rounded-sm border border-border bg-surface-alt px-2 py-1 text-[11px] font-semibold text-muted">
          {t(`admin.iconKey.${item}`)}
        </span>
      ))}
    </div>
  )
}
