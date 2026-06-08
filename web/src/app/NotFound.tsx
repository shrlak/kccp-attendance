import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export function NotFound() {
  const { t } = useTranslation()
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="font-display text-6xl font-semibold text-primary">404</div>
        <p className="text-sm text-muted">{t('notFound.message')}</p>
        <Link to="/" className="text-sm font-semibold text-primary hover:underline">
          {t('notFound.home')}
        </Link>
      </div>
    </main>
  )
}
