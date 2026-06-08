// A thin "you may leave now" countdown after a successful check-in. Inherits the
// state color via `bg-current` on the parent.
export function CountdownBar({ seconds }: { seconds: number }) {
  return (
    <div className="mx-auto mt-6 h-[3px] w-48 overflow-hidden rounded-full bg-border">
      <div className="fx-countdown h-full w-full rounded-full bg-current" style={{ animationDuration: `${seconds}s` }} />
    </div>
  )
}
