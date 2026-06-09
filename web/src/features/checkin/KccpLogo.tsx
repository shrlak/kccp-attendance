import { KccpMark } from './KccpMark'

// The full circular KCCP badge — the mark over the church name + 대학·청년부, ringed by a
// thin circle. Recreated from the provided logo; drop an official asset in to replace.
export function KccpLogo({ size = 220, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={
        // White in light mode (the logo's native ground → crisp green/yellow + navy), a
        // dark surface in dark mode (text flips light) so it reads clearly on both.
        'grid place-items-center rounded-full border border-border bg-white text-center shadow-sm dark:bg-surface ' +
        className
      }
      style={{ width: size, height: size }}
      role="img"
      aria-label="Korean Central Church of Pittsburgh"
    >
      <div className="flex flex-col items-center" style={{ gap: size * 0.02 }}>
        <KccpMark size={size * 0.34} />
        <div
          className="font-display font-semibold uppercase leading-tight tracking-wide text-[#213D66] dark:text-text"
          style={{ fontSize: size * 0.072 }}
        >
          Korean Central Church
          <br />
          of Pittsburgh
        </div>
        <div className="flex overflow-hidden rounded-full" style={{ width: size * 0.2, height: size * 0.012 }}>
          <span className="h-full w-1/2 bg-[#F2E52C]" />
          <span className="h-full w-1/2 bg-[#54C083]" />
        </div>
        <div
          className="font-display font-semibold text-[#213D66] dark:text-text"
          style={{ fontSize: size * 0.082 }}
        >
          대학 · 청년부
        </div>
      </div>
    </div>
  )
}
