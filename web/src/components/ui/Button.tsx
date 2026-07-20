import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'sm'

const base =
  'inline-flex items-center justify-center gap-2 font-sans font-semibold ' +
  'rounded-full min-h-11 disabled:opacity-40 disabled:pointer-events-none ' +
  'transition-[background-color,border-color,color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.96] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

const variants: Record<Variant, string> = {
  primary:
    'border border-primary bg-primary text-primary-fg shadow-md shadow-primary/20 ' +
    'hover:border-primary-hover hover:bg-primary-hover hover:shadow-lg hover:shadow-primary/25 active:shadow-sm',
  secondary: 'border border-border bg-surface text-text hover:border-primary/35 hover:bg-surface-alt hover:shadow-sm',
  ghost: 'border border-transparent bg-transparent text-primary hover:bg-primary/10',
  danger:
    'border border-danger bg-danger text-white shadow-md shadow-danger/20 hover:bg-danger/90 hover:shadow-lg hover:shadow-danger/25 active:shadow-sm',
}
const sizes: Record<Size, string> = {
  md: 'px-5 py-2.5 text-sm',
  sm: 'min-h-9 px-3.5 py-1.5 text-xs',
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
