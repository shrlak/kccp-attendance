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
    <nav aria-label={label} className={`fixed bottom-0 inset-x-0 z-30 flex border-t border-border
                    bg-canvas/[0.92] backdrop-blur-xl
                    pb-[env(safe-area-inset-bottom)] ${className}`}>
      {items.slice(0, 5).map(({ id, label, icon: Icon, badge = 0 }) => {
        const isActive = id === active
        return (
          <button key={id} type="button" onClick={() => onSelect(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2 min-h-12 text-[10px] font-semibold font-sans transition-colors
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary
                        ${isActive ? 'text-primary' : 'text-muted'}`}>
            <span
              className={`relative transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${isActive ? 'scale-110' : 'scale-100'}`}
            >
              <Icon size={21} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
              {badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
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
