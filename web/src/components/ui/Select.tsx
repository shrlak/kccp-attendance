import { forwardRef, type SelectHTMLAttributes } from 'react'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', ...props }, ref) => (
    <select
      ref={ref}
      className={
        'w-full bg-surface text-text border border-border rounded-md px-3.5 py-2.5 ' +
        'text-sm font-sans min-h-11 outline-none appearance-none ' +
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 ' +
        className
      }
      {...props}
    />
  ),
)
Select.displayName = 'Select'
