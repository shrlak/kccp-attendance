import { forwardRef, type InputHTMLAttributes } from 'react'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={
        'w-full bg-surface text-text border border-border rounded-xl px-3.5 py-2.5 ' +
        'text-sm font-sans placeholder:text-subtle min-h-11 outline-none transition ' +
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 ' +
        className
      }
      {...props}
    />
  ),
)
Input.displayName = 'Input'
