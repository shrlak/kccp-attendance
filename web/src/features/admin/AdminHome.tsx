import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { useRoster } from './useRoster'
import { Button } from '../../components/ui/Button'

// Minimal authenticated admin home: shows who you are, your scope, and the
// role-scoped member list from /api/roster. The richer Sheet/Today/Members views
// build on this in later phases.
export function AdminHome() {
  const { t } = useTranslation()
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  const { data, isLoading, isError } = useRoster(true)

  const scopeLabel =
    identity && identity.role === 'leader'
      ? [identity.group, identity.subgroup].filter(Boolean).join(' · ')
      : t('admin.scopeAll')

  return (
    <main className="min-h-dvh">
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-canvas/90 px-5
                   py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur"
      >
        <div>
          <div className="font-display text-lg font-semibold text-text">{t('admin.title')}</div>
          <div className="text-xs text-muted">
            {identity ? t(`admin.roles.${identity.role}`) : ''}
            {identity ? ' · ' : ''}
            {scopeLabel}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          {t('admin.signOut')}
        </Button>
      </header>

      <div className="px-5 py-4">
        {isLoading && <p className="text-sm text-muted">{t('common.loading')}</p>}
        {isError && <p className="text-sm text-danger">{t('common.error')}</p>}
        {data && (
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
        )}
      </div>
    </main>
  )
}
