import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ThemeLangToggle } from '../ui/ThemeLangToggle'
import { Lock } from '../ui/Icon'
import { KccpMark } from '../../features/checkin/KccpMark'

export function AccessShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string
  title: string
  subtitle: string
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(340px,0.78fr)_1.22fr]">
      <section className="relative hidden min-h-dvh flex-col justify-between overflow-hidden border-r border-border bg-surface-alt px-12 py-11 text-text lg:flex">
        {/* Soft ambient accents for depth behind the brand copy. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-gold/10 blur-3xl" />
        </div>

        <Link to="/" className="relative inline-flex w-fit items-center gap-3">
          <KccpMark size={40} />
          <div>
            <div className="text-sm font-bold leading-none tracking-tight">KCCP</div>
            <div className="mt-1 text-[10px] font-semibold tracking-wide text-muted">COLLEGE · YOUNG ADULT</div>
          </div>
        </Link>

        <div className="relative max-w-sm">
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            KCCP Ministry Operations
          </div>
          <p className="mt-5 font-display text-3xl font-bold leading-[1.28] tracking-[-0.025em]">
            {t('access.sideTitle')}
          </p>
          <p className="mt-5 max-w-xs text-sm leading-6 text-muted">{t('access.sideText')}</p>
        </div>

        <div className="relative flex items-center gap-2.5 border-t border-border pt-5 text-xs font-medium text-muted">
          <span className="grid size-6 place-items-center rounded-full bg-success/15 text-success">
            <Lock className="size-3" strokeWidth={2.25} aria-hidden />
          </span>
          {t('access.secure')}
        </div>
      </section>

      <section className="relative flex min-h-dvh items-center justify-center px-5 py-20 sm:px-8">
        <div className="absolute right-5 top-5 flex items-center gap-1 pt-[env(safe-area-inset-top)] sm:right-8 sm:top-7">
          <ThemeLangToggle />
        </div>

        <div className="fx-rise w-full max-w-[420px]">
          <Link to="/" className="mb-10 inline-flex items-center gap-2.5 lg:hidden">
            <KccpMark size={32} />
            <span className="text-sm font-bold tracking-tight text-text">KCCP 대학 · 청년부</span>
          </Link>

          <div className="surface-panel p-7 shadow-[var(--shadow-lg)] sm:p-8">
            <div className="section-kicker">{eyebrow}</div>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-text">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-muted">{subtitle}</p>

            <div className="mt-7 border-t border-separator pt-7">{children}</div>
          </div>

          <Link to="/" className="mt-6 inline-flex text-xs font-semibold text-muted underline-offset-4 hover:text-text hover:underline">
            {t('access.backHome')}
          </Link>
        </div>
      </section>
    </main>
  )
}
