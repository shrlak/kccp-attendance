import type { LucideIcon } from './Icon'

export interface NavItem { id: string; label: string; icon: LucideIcon }
export interface BottomNavProps {
  items: NavItem[]            // 5 max (Material guideline)
  active: string
  onSelect: (id: string) => void
}

export function BottomNav({ items, active, onSelect }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-10 mx-auto max-w-[960px] flex
                    bg-canvas/95 backdrop-blur border-t border-border
                    pb-[env(safe-area-inset-bottom)]">
      {items.slice(0, 5).map(({ id, label, icon: Icon }) => {
        const isActive = id === active
        return (
          <button key={id} type="button" onClick={() => onSelect(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 min-h-11 text-[10px] font-semibold font-sans
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary
                        ${isActive ? 'text-primary' : 'text-subtle'}`}>
            <Icon size={20} strokeWidth={2} aria-hidden />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
