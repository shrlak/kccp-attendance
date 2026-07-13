import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KccpMark } from '../features/checkin/KccpMark'

export function NotFound() {
  const { t } = useTranslation()
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6">
      <div className="surface-panel w-full max-w-md px-8 py-10 text-left">
        <KccpMark size={40} />
        <div className="section-kicker mt-10">Error · 404</div>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-text">{t('notFound.message')}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{t('notFound.description')}</p>
        <Link to="/" className="mt-7 inline-flex rounded-md border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
          {t('notFound.home')}
        </Link>
      </div>
    </main>
  )
}
