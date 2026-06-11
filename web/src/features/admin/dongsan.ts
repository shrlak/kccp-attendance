import type { DongsanNames, DongsanLeaders, DongsanLeaderEntry, Member } from '../../lib/api'

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

// ── 동산지기 / 부동산지기 display roles (feature 2.18) ──────────────────────
// Pure helpers mirroring the legacy getDongsanRole()/editor logic. The leaders map is
// keyed by group (or "합동" in summer mode) → 동산 name → { leader, subLeaders }.

export type DongsanRole = '동산지기' | '부동산지기' | null

const EMPTY_ENTRY: DongsanLeaderEntry = { leader: '', subLeaders: [] }

// The 동산지기/부동산지기 role for `name` in their 동산, or null. In summer mode the "합동"
// key wins when present; otherwise we fall through to the per-group lookup (exact legacy
// getDongsanRole behaviour).
export function getDongsanRole(
  name: string,
  group: string,
  subgroup: string,
  leaders: DongsanLeaders | undefined,
  summerMode: boolean,
): DongsanRole {
  if (!leaders || !subgroup) return null
  const match = (entry: DongsanLeaderEntry | undefined): DongsanRole => {
    if (!entry) return null
    if (entry.leader === name) return '동산지기'
    if ((entry.subLeaders ?? []).includes(name)) return '부동산지기'
    return null
  }
  if (summerMode) {
    const combined = leaders['합동']?.[subgroup]
    if (combined) return match(combined)
  }
  if (!group) return null
  return match(leaders[group]?.[subgroup])
}

// ── 임원 (officer) display badge ────────────────────────────────────────────
// `officers` is the config-managed name list (config.officers, edited in the 동산 tab).
// Undefined (endpoint unreachable / still loading) means no badges — graceful degradation.

export function isOfficer(name: string, officers: string[] | undefined): boolean {
  return !!name && !!officers && officers.includes(name)
}

// The stored entry for a 동산 (defaulting to empty), used to seed the editor.
export function leaderEntry(leaders: DongsanLeaders, group: string, subgroup: string): DongsanLeaderEntry {
  return leaders[group]?.[subgroup] ?? EMPTY_ENTRY
}

// Flat, de-duped list of every 동산 name across all groups — the summer-mode 합동 list.
export function summerDongsanList(names: DongsanNames): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of Object.keys(names)) {
    for (const n of names[group] ?? []) {
      if (n && !seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
  }
  return out
}

// Member names in a 동산, de-duped + sorted. `group` null matches across all groups
// (summer-mode 합동); otherwise it must match the member's 부서.
export function membersInDongsan(members: Member[], group: string | null, subgroup: string): string[] {
  const names = members
    .filter((m) => (group === null || m.group_name === group) && (m.subgroup || '') === (subgroup || ''))
    .map((m) => m.name)
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
}

// Immutable edit of a single 동산's entry — set the leader.
export function withLeader(entry: DongsanLeaderEntry, name: string): DongsanLeaderEntry {
  return { ...entry, leader: name }
}

// Immutable edit — toggle a sub-leader on/off.
export function toggleSubLeader(entry: DongsanLeaderEntry, name: string): DongsanLeaderEntry {
  const has = entry.subLeaders.includes(name)
  return { ...entry, subLeaders: has ? entry.subLeaders.filter((n) => n !== name) : [...entry.subLeaders, name] }
}
