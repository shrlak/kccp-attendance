// Term (학기) calendar helpers — the server-side twin of the web app's
// `lib/semester.ts` + `features/admin/archive.ts` date math, kept pure so it can be
// unit-tested (see term.test.ts) and reused by index.ts.
//
// Two things run off this:
//  1. 여름 모드 — no longer a switch an admin flips. It is simply "is today inside the
//     configured 여름학기", so it turns itself on when the term starts and off when it ends.
//  2. 학기 종료 롤오버 — the day after a 학기 ends, the 동산 편성 is cleared (see
//     rolloverDongsan in index.ts); this module decides *which* term just ended.

export type Season = "spring" | "summer" | "fall";
export const SEASONS: Season[] = ["spring", "summer", "fall"];

export interface SemesterRange {
  start: string; // MM-DD, inclusive
  end: string; // MM-DD, inclusive
}
export type SemesterDates = Record<Season, SemesterRange>;

// Mirrors web/src/lib/semester.ts DEFAULT_SEMESTER_DATES — the boundaries used until a
// super-admin saves a schedule of their own.
export const DEFAULT_SEMESTER_DATES: SemesterDates = {
  spring: { start: "01-01", end: "05-09" },
  summer: { start: "05-10", end: "08-14" },
  fall: { start: "08-15", end: "12-31" },
};

// A stored schedule if it looks like one, else the defaults. (index.ts validates saved
// schedules on write with validSemesterDates; this is the read-side fallback.)
export function semesterDatesOf(value: unknown): SemesterDates {
  const ranges = value as Partial<Record<Season, Partial<SemesterRange>>> | null | undefined;
  if (!ranges || typeof ranges !== "object") return DEFAULT_SEMESTER_DATES;
  for (const season of SEASONS) {
    const range = ranges[season];
    if (!range || !/^\d{2}-\d{2}$/.test(String(range.start)) || !/^\d{2}-\d{2}$/.test(String(range.end))) {
      return DEFAULT_SEMESTER_DATES;
    }
  }
  return ranges as SemesterDates;
}

// The ISO bounds of one season in one calendar year (the saved MM-DD projected into it).
export function termBounds(year: number, season: Season, dates: SemesterDates): { start: string; end: string } {
  return { start: `${year}-${dates[season].start}`, end: `${year}-${dates[season].end}` };
}

// 여름 모드: on for exactly as long as the 여름학기 runs. 대학부·청년부 are combined into
// 합동 동산 while it is on (scopeFilter/dongsan naming), and split again the day it ends.
export function isSummerTerm(today: string, semesterDates?: unknown): boolean {
  const dates = semesterDatesOf(semesterDates);
  const { start, end } = termBounds(Number(today.slice(0, 4)), "summer", dates);
  return today >= start && today <= end;
}

// The season `today` falls in, or null between two terms (a gap only exists when the saved
// schedule leaves one).
export function currentSeason(today: string, semesterDates?: unknown): Season | null {
  const dates = semesterDatesOf(semesterDates);
  const year = Number(today.slice(0, 4));
  for (const season of SEASONS) {
    const { start, end } = termBounds(year, season, dates);
    if (today >= start && today <= end) return season;
  }
  return null;
}

// Key ("2026-summer") of the most recently *finished* term as of `today` — the term whose
// 동산 편성 the rollover retires. Looks back one year so early-January still finds the
// previous 가을학기. Null only if no term has ever ended before `today` (not reachable with
// real schedules, but keeps the caller total).
export function lastEndedTermKey(today: string, semesterDates?: unknown): string | null {
  const dates = semesterDatesOf(semesterDates);
  const year = Number(today.slice(0, 4));
  let best: { key: string; end: string } | null = null;
  for (const y of [year - 1, year]) {
    for (const season of SEASONS) {
      const { end } = termBounds(y, season, dates);
      if (end >= today) continue; // still running, or ends today → not finished yet
      if (!best || end > best.end) best = { key: `${y}-${season}`, end };
    }
  }
  return best ? best.key : null;
}

// One retired term's 동산 편성, kept so the 출석부 archives can still group that term's sheet
// by the 동산 people were actually in (the live assignment is wiped at rollover).
export interface TermDongsan {
  endedAt: string; // ISO date the rollover ran
  subgroups: Record<string, string>; // member id → 동산
  names: Record<string, unknown>; // config.dongsan_names as it stood
  leaders: Record<string, unknown>; // config.dongsan_leaders as it stood
}
export type DongsanHistory = Record<string, TermDongsan>;

// How many retired terms to keep. Roughly four academic years — enough for any archive an
// admin would still download, while keeping the config row (and the roster payload that
// carries it) small.
export const HISTORY_LIMIT = 12;

// Drop the oldest entries past `limit`, newest kept — ordered by when each rollover ran, so
// the key's own (year, season) ordering never has to be parsed.
export function trimHistory(history: DongsanHistory, limit: number = HISTORY_LIMIT): DongsanHistory {
  const keys = Object.keys(history);
  if (keys.length <= limit) return history;
  const newest = keys
    .sort((a, b) => (history[b]?.endedAt || "").localeCompare(history[a]?.endedAt || "") || b.localeCompare(a))
    .slice(0, limit);
  const out: DongsanHistory = {};
  for (const key of newest) out[key] = history[key];
  return out;
}

// The 동산 편성 to freeze for a term: member id → 동산, skipping the unassigned.
export function subgroupSnapshot(members: { id: string; subgroup?: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of members) {
    const sub = (m.subgroup || "").trim();
    if (sub) out[m.id] = sub;
  }
  return out;
}
