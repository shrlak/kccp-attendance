import { KccpMark } from './KccpMark'

// A compact church wordmark for operational screens. The official mark stays intact,
// while the typography is intentionally quieter than the attendance content around it.
// `stacked` centers the mark above the wordmark for hero placements.
export function KccpLogo({
  size = 52,
  className = '',
  stacked = false,
}: {
  size?: number
  className?: string
  stacked?: boolean
}) {
  if (stacked) {
    return (
      <div
        className={'flex flex-col items-center text-center ' + className}
        role="img"
        aria-label="Korean Central Church of Pittsburgh"
      >
        <KccpMark size={size} />
        <div className="mt-6 font-display text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-subtle">
          Korean Central Church
        </div>
        <div className="mt-2 font-display text-lg font-bold leading-tight tracking-tight text-text">
          피츠버그 한인중앙교회
        </div>
        <div className="mt-1 text-sm font-semibold text-primary">대학 · 청년부</div>
      </div>
    )
  }
  return (
    <div
      className={'inline-flex items-center gap-3 text-left ' + className}
      role="img"
      aria-label="Korean Central Church of Pittsburgh"
    >
      <KccpMark size={size} className="shrink-0" />
      <div className="border-l border-border pl-3">
        <div className="font-display text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-subtle">
          Korean Central Church
        </div>
        <div className="mt-1 font-display text-sm font-bold leading-tight tracking-tight text-text">
          피츠버그 한인중앙교회
        </div>
        <div className="mt-0.5 text-xs font-semibold text-primary">
          대학 · 청년부
        </div>
      </div>
    </div>
  )
}
