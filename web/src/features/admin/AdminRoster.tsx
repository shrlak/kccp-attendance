import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'

// The role-scoped member list (super/pastor → all; leader → their 동산).
export function AdminRoster() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  return (
    <>
      <div className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">
        {t('admin.roster')} · {data.members.length}
      </div>
      {data.members.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.noMembers')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {(m.name || '?').slice(0, 1)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-text">
                    {m.name}
                    {m.is_new_member && <span className="ml-1.5 align-middle text-xs">🌟</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              </div>
              {m.member_role && (
                <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-muted">
                  {m.member_role}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
