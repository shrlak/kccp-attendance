interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}

// Accessible on/off toggle (role="switch"), sized to iOS proportions. Used for the
// app-wide setting flags.
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
        'relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full p-0.5 ' +
        'transition-[background-color,box-shadow] duration-300 [transition-timing-function:var(--ease-out-soft)] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ' +
        'focus-visible:ring-offset-canvas disabled:opacity-40 ' +
        (checked ? 'bg-primary' : 'bg-fill-hover')
      }
    >
      <span
        className={
          'inline-block h-[26px] w-[26px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25),0_2px_6px_rgba(0,0,0,0.12)] ' +
          'transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ' +
          (checked ? 'translate-x-5' : 'translate-x-0')
        }
      />
    </button>
  )
}
