import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { LoginGate } from '../admin/LoginGate'
import { CardScanDialog } from '../admin/CardScanDialog'
import { KccpMark } from '../checkin/KccpMark'
import { Button } from '../../components/ui/Button'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'
import { ScanLine, ImagePlus, AlertTriangle, ArrowRight } from '../../components/ui/Icon'
import { readSharedCards, clearSharedCards } from '../../lib/sharedCards'

// ── /share — the 새가족 카드 사진 등록 shortcut ────────────────────────────────
// Two ways in, both skipping the 사이트 → 로그인 → 새가족 탭 → 카드 사진 등록 walk:
//   1. The phone's share sheet. 사진 앱 → 공유 → KCCP 출석 posts the photos to the
//      service worker (src/sw.ts), which parks them and sends the browser here; they
//      are already waiting by the time this screen mounts. Requires the app to be
//      installed to the home screen, and a browser that implements Web Share Target
//      (Chrome/Edge on Android today — iOS Safari does not expose it to web apps).
//   2. The home-screen icon (or its long-press shortcut) opening /share directly, which
//      lands on the 사진 선택 button below — one tap to the camera/library. That path
//      works everywhere, including iPhones.
export function ShareTargetScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const status = useAdminAuth((s) => s.status)
  const identity = useAdminAuth((s) => s.identity)
  // null while the hand-off is being read out of the Cache API.
  const [shared, setShared] = useState<File[] | null>(null)
  // Set only by the 사진 선택 button — the picker path, for when nothing was shared.
  const [pickerOpen, setPickerOpen] = useState(false)

  const authed = status === 'authed'
  // Pastors are read-only and can't register anyone — matching the 새가족 tab, which
  // hides 카드 사진 등록 for them.
  const readOnly = identity?.role === 'pastor'
  const ready = shared !== null
  const count = shared?.length ?? 0
  // A real share has nothing left to decide, so it goes straight into review; the picker
  // path waits for a tap. Derived rather than held in state, so there's no frame where
  // the screen has the photos but hasn't opened the dialog yet.
  const scanning = authed && !readOnly && (count > 0 || pickerOpen)

  // Reading the hand-off is non-destructive on purpose: a share that arrives on a
  // signed-out device has to survive the login — including the Google round-trip, which
  // reloads the page. The effect below is what consumes it, once the dialog has the files.
  useEffect(() => {
    let live = true
    void readSharedCards()
      .then((files) => live && setShared(files))
      .catch(() => live && setShared([]))
    return () => {
      live = false
    }
  }, [])

  // The dialog owns the files from here; drop the hand-off so a reload — or a later visit
  // to /share — never re-registers the same card.
  useEffect(() => {
    if (scanning && count > 0) void clearSharedCards()
  }, [scanning, count])

  // Signed-out: the ordinary login screen. The photos stay parked until it succeeds.
  if (!authed) return <LoginGate />

  return (
    <main className="relative flex min-h-dvh flex-col bg-canvas">
      <header className="material-bar sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)]">
        <div className="safe-x mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <KccpMark size={24} />
            <span className="truncate text-sm font-bold tracking-tight text-text">{t('share.title')}</span>
          </Link>
          <ThemeLangToggle />
        </div>
      </header>

      <section className="safe-x mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span
          className={
            'grid size-16 place-items-center rounded-[22px] border border-border bg-surface shadow-[var(--shadow)] ' +
            (ready ? '' : 'fx-pulse')
          }
        >
          {readOnly ? (
            <AlertTriangle className="size-7 text-warning" strokeWidth={1.75} aria-hidden />
          ) : count > 0 ? (
            <ImagePlus className="size-7 text-primary" strokeWidth={1.75} aria-hidden />
          ) : (
            <ScanLine className="size-7 text-primary" strokeWidth={1.75} aria-hidden />
          )}
        </span>

        {readOnly ? (
          <>
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-text">{t('share.title')}</h1>
            <p className="text-sm leading-6 text-muted">{t('share.readOnly')}</p>
            <Button variant="secondary" onClick={() => navigate('/admin')}>
              {t('share.goToPanel')}
              <ArrowRight className="size-4" strokeWidth={2} aria-hidden />
            </Button>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-text">
              {count > 0 ? t('share.received', { n: count }) : t('share.title')}
            </h1>
            <p className="text-sm leading-6 text-muted">{count > 0 ? t('share.receivedHint') : t('share.emptyHint')}</p>
            {ready && count === 0 && (
              <Button onClick={() => setPickerOpen(true)} className="w-full max-w-xs">
                <ScanLine className="size-4" strokeWidth={2} aria-hidden />
                {t('share.pick')}
              </Button>
            )}
            <Link
              to="/admin"
              className="text-xs font-semibold text-muted underline-offset-4 hover:text-text hover:underline"
            >
              {t('share.goToPanel')}
            </Link>
          </>
        )}
      </section>

      {scanning && (
        <CardScanDialog
          open
          initialFiles={shared ?? undefined}
          // The share entry point has no panel behind it, so finishing (or backing out)
          // lands in the admin panel rather than on a blank shortcut screen.
          onClose={() => navigate('/admin')}
        />
      )}
    </main>
  )
}
