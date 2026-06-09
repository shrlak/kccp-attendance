import type { DongsanNames } from '../../lib/api'

// Pure, immutable editing helpers for the 동산-names map ({ [group]: string[] }).
// Each function returns a NEW map (and new inner array for the touched group) so React
// state updates stay referentially honest. Unknown groups are treated as empty lists.

function listFor(names: DongsanNames, group: string): string[] {
  return names[group] ?? []
}

// Rename the 동산 at `idx` within `group`. Out-of-range indices are no-ops.
export function renameAt(names: DongsanNames, group: string, idx: number, value: string): DongsanNames {
  const list = listFor(names, group)
  if (idx < 0 || idx >= list.length) return names
  const next = list.slice()
  next[idx] = value
  return { ...names, [group]: next }
}

// Append a new empty 동산 slot to `group` (creating the group if it doesn't exist).
export function addDongsan(names: DongsanNames, group: string): DongsanNames {
  return { ...names, [group]: [...listFor(names, group), ''] }
}

// Remove the 동산 at `idx` within `group`. Out-of-range indices are no-ops.
export function removeAt(names: DongsanNames, group: string, idx: number): DongsanNames {
  const list = listFor(names, group)
  if (idx < 0 || idx >= list.length) return names
  return { ...names, [group]: list.filter((_, i) => i !== idx) }
}

// Trim every name and drop blank entries — what we persist on Save.
export function cleanNames(names: DongsanNames): DongsanNames {
  const out: DongsanNames = {}
  for (const group of Object.keys(names)) {
    out[group] = listFor(names, group)
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
  }
  return out
}
