import { forwardRef, type SelectHTMLAttributes } from 'react'

// The native dropdown arrow is removed (appearance-none) for consistent cross-browser
// styling, so draw our own down-chevron as a background image to keep the affordance.
const CARET =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23637068' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', style, ...props }, ref) => (
    <select
      ref={ref}
      style={{
        backgroundImage: CARET,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.875rem center',
        backgroundSize: '16px',
        ...style,
      }}
      className={
        'w-full rounded-xl border border-border bg-surface pl-3.5 pr-10 py-2.5 text-text ' +
        'text-sm font-sans min-h-11 outline-none appearance-none cursor-pointer ' +
        'transition-[border-color,box-shadow,background-color] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        'hover:border-primary/30 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 ' +
        className
      }
      {...props}
    />
  ),
)
Select.displayName = 'Select'
