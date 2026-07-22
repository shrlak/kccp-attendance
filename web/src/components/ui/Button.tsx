import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'sm'

const base =
  'inline-flex items-center justify-center gap-2 font-sans font-semibold tracking-[-0.01em] ' +
  'rounded-full min-h-11 select-none disabled:opacity-40 disabled:pointer-events-none ' +
  'transition-[background-color,border-color,color,transform,box-shadow,filter] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
  'active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

const variants: Record<Variant, string> = {
  // Filled accent — the one high-emphasis action per view.
  primary:
    'border border-transparent bg-primary text-primary-fg shadow-[var(--shadow-sm)] ' +
    'hover:bg-primary-hover hover:brightness-[1.02] hover:shadow-[0_4px_16px_color-mix(in_srgb,var(--primary)_35%,transparent)] active:brightness-95',
  // Neutral raised surface — the default for most actions.
  secondary:
    'border border-border bg-surface text-text shadow-[var(--shadow-sm)] ' +
    'hover:border-primary/30 hover:bg-surface-alt active:bg-surface-alt',
  // Text-weight action — used inline where a filled control would be too heavy.
  ghost: 'border border-transparent bg-transparent text-primary hover:bg-fill active:bg-fill-hover',
  // Destructive filled.
  danger:
    'border border-transparent bg-danger text-white shadow-[var(--shadow-sm)] ' +
    'hover:brightness-[1.04] hover:shadow-[0_4px_16px_color-mix(in_srgb,var(--danger)_35%,transparent)] active:brightness-95',
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
