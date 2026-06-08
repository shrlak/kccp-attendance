import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getConfig } from '../../lib/api'
import { Button } from '../../components/ui/Button'

// Phase-0 PLACEHOLDER: proves data + design + deploy end-to-end.
// The real check-in flow (window/geo/offline/guest) lands in the Phase 0 Check-in plan.
export function CheckinScreen() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-text">{t('checkin.greeting')}</h1>
      {data?.announcement && <p className="text-muted text-sm max-w-sm">{data.announcement}</p>}
      {isError && <p className="text-danger text-sm">{t('common.error')}</p>}
      <Button disabled={isLoading}>{t('checkin.button')}</Button>
      <p className="font-mono text-xs text-subtle">{isLoading ? t('common.loading') : 'config loaded ✓'}</p>
    </main>
  )
}
