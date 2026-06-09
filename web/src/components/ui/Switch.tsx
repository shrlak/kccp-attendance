interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}

// Accessible on/off toggle (role="switch"). Used for the app-wide setting flags.
export function Switch({ checked, onChange, disabled = false, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ' +
        'focus-visible:ring-offset-canvas disabled:opacity-40 ' +
        (checked ? 'bg-primary' : 'bg-border')
      }
    >
      <span
        className={
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ' +
          (checked ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  )
}
