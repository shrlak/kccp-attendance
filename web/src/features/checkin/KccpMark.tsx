// A warm "rising sun over an arch" mark — welcoming, church-adjacent, and on-brand
// with the clay-coral system. Inherits color via `currentColor`.
export function KccpMark({ size = 120, className = '' }: { size?: number; className?: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = ((i * 30 - 90) * Math.PI) / 180
    const inner = 30
    const outer = 38
    return (
      <line
        key={i}
        x1={60 + Math.cos(a) * inner}
        y1={64 + Math.sin(a) * inner}
        x2={60 + Math.cos(a) * outer}
        y2={64 + Math.sin(a) * outer}
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity={0.7}
      />
    )
  })
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className} role="img" aria-label="KCCP">
      <circle cx="60" cy="60" r="56" stroke="currentColor" strokeWidth="1.5" opacity={0.16} />
      <circle cx="60" cy="60" r="45" stroke="currentColor" strokeWidth="1" opacity={0.1} />
      <circle cx="60" cy="64" r="20" fill="currentColor" opacity={0.92} />
      {rays}
      <path d="M30 92 Q60 80 90 92" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity={0.5} />
    </svg>
  )
}
