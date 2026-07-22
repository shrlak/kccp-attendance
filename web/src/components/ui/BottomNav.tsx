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
    <nav aria-label={label} className={`material-bar fixed bottom-0 inset-x-0 z-30 flex border-t
                    pb-[env(safe-area-inset-bottom)] ${className}`}>
      {items.slice(0, 5).map(({ id, label, icon: Icon, badge = 0 }) => {
        const isActive = id === active
        return (
          <button key={id} type="button" onClick={() => onSelect(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`group relative flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2 min-h-12 text-[10px] font-semibold font-sans transition-colors
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary
                        ${isActive ? 'text-primary' : 'text-muted hover:text-text'}`}>
            <span
              className={`relative grid h-8 w-14 place-items-center rounded-full transition-[transform,background-color] duration-300 [transition-timing-function:var(--ease-spring)]
                          ${isActive ? 'scale-105 bg-primary/10' : 'scale-100 group-active:bg-fill'}`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.3 : 1.9} aria-hidden />
              {badge > 0 && (
                <span className="absolute right-2 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white ring-2 ring-[var(--material)]">
                  {badge}
                </span>
              )}
            </span>
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
