import type { LogEntry } from '../../lib/api'

// ── Today's printable check-in sheet (pure model) ────────────────────────────
// A numbered roll sheet for a single 부서: 60 slots laid out in 4 columns of 15.
// Members who checked in today drop into the slots in the order they checked in.
// The DOM/canvas rendering + image download live in todaySheetImage.ts.

// The two KM departments that each get their own sheet page.
export const TODAY_SHEET_GROUPS = ['대학부', '청년부'] as const

export const TODAY_SHEET_SLOTS = 60
export const TODAY_SHEET_COLUMNS = 4
export const TODAY_SHEET_ROWS = TODAY_SHEET_SLOTS / TODAY_SHEET_COLUMNS // 15

// Names that checked in today for `group`, in order of check-in (earliest first),
// deduped — a member who checked in twice keeps their first (earliest) slot.
export function todayGroupRoster(log: LogEntry[], today: string, group: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const e of log.filter((e) => e.date === today && e.group === group).sort((a, b) => a.ts - b.ts)) {
    if (!e.name || seen.has(e.name)) continue
    seen.add(e.name)
    names.push(e.name)
  }
  return names
}

export interface TodaySheetSlot {
  num: number
  name: string
}

// The 60 numbered slots filled column-major: slots 1–15 run down the first column,
// 16–30 the second, and so on. `name` is '' for an empty (not-yet-checked-in) slot.
export function todaySheetSlots(names: string[]): TodaySheetSlot[] {
  return Array.from({ length: TODAY_SHEET_SLOTS }, (_, i) => ({ num: i + 1, name: names[i] ?? '' }))
}

// Image filename: kccp-today-{group}-{YYYY-MM-DD}.{ext}.
export function todaySheetFilename(group: string, date: string, ext: 'png' | 'jpg'): string {
  const g = group.trim().replace(/\s+/g, '')
  return `kccp-today-${g ? `${g}-` : ''}${date}.${ext}`
}
