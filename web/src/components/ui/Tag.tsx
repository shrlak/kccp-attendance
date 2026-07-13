import type { HTMLAttributes } from 'react'

type Tone = 'primary' | 'gold' | 'info' | 'success' | 'muted'

const tones: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  gold: 'bg-gold/15 text-gold',
  info: 'bg-info/10 text-info',
  success: 'bg-success/15 text-success',
  muted: 'bg-surface-alt text-muted',
}

export function Tag({
  tone = 'muted',
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-sans ${tones[tone]} ${className}`}
      {...props}
    />
  )
}
