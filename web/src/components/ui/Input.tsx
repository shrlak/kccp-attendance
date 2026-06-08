import { forwardRef, type InputHTMLAttributes } from 'react'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={
        'w-full bg-surface text-text border border-border rounded-md px-3.5 py-2.5 ' +
        'text-sm font-sans placeholder:text-subtle min-h-11 outline-none ' +
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 ' +
        className
      }
      {...props}
    />
  ),
)
Input.displayName = 'Input'
