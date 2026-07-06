import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

export type IconKeyItem = 'newFamily' | 'visitor' | 'firstVisit' | 'newMemberStar'

// Small legend explaining the status icons used in a tab's lists,
// e.g. "✝️ 새가족 · 👋 방문자" — one muted line, entries joined by a dot.
export function IconKey({ items }: { items: IconKeyItem[] }) {
  const { t } = useTranslation()
  return (
    <p className="mb-3 text-sm text-muted">
      {items.map((item, i) => (
        <Fragment key={item}>
          {i > 0 && <span className="text-subtle"> · </span>}
          {t(`admin.iconKey.${item}`)}
        </Fragment>
      ))}
    </p>
  )
}
