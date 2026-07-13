import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'sm'

const base =
  'inline-flex items-center justify-center gap-2 font-sans font-semibold ' +
  'transition-[background-color,border-color,color,transform] min-h-11 disabled:opacity-40 disabled:pointer-events-none active:translate-y-px ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

const variants: Record<Variant, string> = {
  primary: 'border border-primary bg-primary text-primary-fg hover:border-primary-hover hover:bg-primary-hover',
  secondary: 'border border-border bg-surface text-text hover:border-primary/35 hover:bg-surface-alt',
  ghost: 'border border-transparent bg-transparent text-muted hover:bg-surface-alt hover:text-text',
  danger: 'border border-danger bg-danger text-white hover:bg-danger/90',
}
const sizes: Record<Size, string> = {
  md: 'rounded-md px-4 py-2.5 text-sm',
  sm: 'min-h-9 rounded-sm px-3 py-1.5 text-xs',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', ...props }, ref) => (
    <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />
  ),
)
Button.displayName = 'Button'
