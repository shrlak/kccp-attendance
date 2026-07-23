import { forwardRef, type InputHTMLAttributes } from 'react'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={
        'w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-text ' +
        'min-h-11 text-sm font-sans placeholder:text-subtle outline-none ' +
        'shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] ' +
        'transition-[border-color,box-shadow,background-color] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        'hover:border-primary/30 focus-visible:border-primary focus-visible:ring-[3.5px] focus-visible:ring-primary/18 ' +
        className
      }
      {...props}
    />
  ),
)
Input.displayName = 'Input'
