import type { HTMLAttributes } from 'react'

/**
 * Elevated content surface. `hover` adds a gentle lift on pointer devices for
 * interactive cards; otherwise it rests at the ambient card elevation.
 */
export function Card({
  className = '',
  hover = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={
        'rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)] ' +
        'transition-[box-shadow,transform,border-color] duration-300 [transition-timing-function:var(--ease-out-soft)] ' +
        (hover ? 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)] ' : '') +
        className
      }
      {...props}
    />
  )
}
