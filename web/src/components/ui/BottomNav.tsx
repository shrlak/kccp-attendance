import type { LucideIcon } from './Icon'

export interface NavItem { id: string; label: string; icon: LucideIcon; badge?: number }
export interface BottomNavProps {
  items: NavItem[]            // 5 max (Material guideline)
  active: string
  onSelect: (id: string) => void
  className?: string
  /** Landmark label — keep distinct from any sibling <nav> for screen-reader users. */
  label?: string
}

export function BottomNav({ items, active, onSelect, className = '', label }: BottomNavProps) {
  return (
    // The left/right insets matter in landscape, where the notch and the rounded display
    // corners eat into the first and last tab's tap area.
    <nav aria-label={label} className={`material-bar fixed bottom-0 inset-x-0 z-30 flex border-t
                    pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)] ${className}`}>
      {items.slice(0, 5).map(({ id, label, icon: Icon, badge = 0 }) => {
        const isActive = id === active
        return (
          <button key={id} type="button" onClick={() => onSelect(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`group relative flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 pt-2.5 pb-2 min-h-12 text-[10px] font-semibold font-sans transition-colors
                        short:gap-0.5 short:pt-1.5
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary
                        ${isActive ? 'text-primary' : 'text-muted hover:text-text'}`}>
            <span
              className={`relative grid h-8 w-full max-w-14 place-items-center rounded-full transition-[transform,background-color] duration-300 [transition-timing-function:var(--ease-spring)]
                          short:h-7
                          ${isActive ? 'scale-105 bg-primary/10' : 'scale-100 group-active:bg-fill'}`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.3 : 1.9} aria-hidden />
              {badge > 0 && (
                <span className="absolute right-2 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white ring-2 ring-[var(--material)]">
                  {badge}
                </span>
              )}
            </span>
            {/* Korean tab names (새가족 교육, 동산 편성…) are wider than a fifth of a small
                phone; clip rather than let a long one stretch its tab and shove the rest. */}
            <span className="w-full truncate text-center">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
