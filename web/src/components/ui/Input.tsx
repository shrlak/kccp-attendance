import { forwardRef, type InputHTMLAttributes } from 'react'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={
        'w-full rounded-md border border-border bg-surface px-3.5 py-2.5 text-text ' +
        'min-h-11 text-sm font-sans placeholder:text-subtle outline-none transition ' +
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 ' +
        className
      }
      {...props}
    />
  ),
)
Input.displayName = 'Input'
