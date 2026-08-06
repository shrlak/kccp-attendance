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

// ── 2년치 학기 일정 (rolling schedule) ───────────────────────────────────────
// Mirror of web/src/lib/semester.ts: on top of the recurring MM-DD template sits a list of
// concrete terms, so 2026 가을학기 and 2027 가을학기 can differ. The 설정 탭 edits the terms
// that haven't finished yet (WINDOW_TERMS of them); as each one ends it leaves that window
// and a fresh term is appended at the back. Finished terms stay in the array — the 지난 학기
// 출석부 needs the dates the term actually ran on — until they age past PAST_TERMS.

export interface SemesterTerm {
  year: number;
  season: Season;
  start: string; // ISO YYYY-MM-DD, inclusive
  end: string; // ISO YYYY-MM-DD, inclusive
}
export type SemesterSchedule = SemesterTerm[];

export const WINDOW_TERMS = 6; // 2 academic years (가을·봄·여름 × 2)
export const PAST_TERMS = 12;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A stored schedule if every entry is a real forward-running term in order, else [].
export function scheduleOf(value: unknown): SemesterSchedule {
  if (!Array.isArray(value)) return [];
  const out: SemesterSchedule = [];
  for (const raw of value) {
    const term = raw as Partial<SemesterTerm>;
    if (!Number.isInteger(term.year) || !SEASONS.includes(term.season as Season)) return [];
    if (typeof term.start !== "string" || typeof term.end !== "string") return [];
    if (!ISO_DATE_RE.test(term.start) || !ISO_DATE_RE.test(term.end) || term.start > term.end) return [];
    out.push({ year: term.year as number, season: term.season as Season, start: term.start, end: term.end });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// Same contract as the web's isValidSchedule — what /api/admin/settings will accept.
export function validSchedule(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > PAST_TERMS + WINDOW_TERMS) return false;
  const parsed = scheduleOf(value);
  if (parsed.length !== value.length) return false;
  let prevEnd = "";
  for (const term of parsed) {
    if (prevEnd && term.start <= prevEnd) return false;
    prevEnd = term.end;
  }
  return true;
}

// The ISO bounds of one season in one calendar year: the schedule's entry when it lists that
// term, else the recurring MM-DD template projected into the year.
export function termBounds(
  year: number,
  season: Season,
  dates: SemesterDates,
  schedule: SemesterSchedule = [],
): { start: string; end: string } {
  const listed = schedule.find((t) => t.year === year && t.season === season);
  if (listed) return { start: listed.start, end: listed.end };
  return { start: `${year}-${dates[season].start}`, end: `${year}-${dates[season].end}` };
}

// 여름 모드: on for exactly as long as the 여름학기 runs. 대학부·청년부 are combined into
// 합동 동산 while it is on (scopeFilter/dongsan naming), and split again the day it ends.
export function isSummerTerm(today: string, semesterDates?: unknown, semesterSchedule?: unknown): boolean {
  const dates = semesterDatesOf(semesterDates);
  const { start, end } = termBounds(Number(today.slice(0, 4)), "summer", dates, scheduleOf(semesterSchedule));
  return today >= start && today <= end;
}

// The season `today` falls in, or null between two terms (a gap only exists when the saved
// schedule leaves one).
export function currentSeason(today: string, semesterDates?: unknown, semesterSchedule?: unknown): Season | null {
  const dates = semesterDatesOf(semesterDates);
  const schedule = scheduleOf(semesterSchedule);
  const year = Number(today.slice(0, 4));
  for (const season of SEASONS) {
    const { start, end } = termBounds(year, season, dates, schedule);
    if (today >= start && today <= end) return season;
  }
  return null;
}

// The term right after `season` in calendar order: 봄 → 여름 → 가을 → 다음 해 봄.
export function nextSeason(year: number, season: Season): { year: number; season: Season } {
  const i = SEASONS.indexOf(season);
  return i === SEASONS.length - 1 ? { year: year + 1, season: SEASONS[0] } : { year, season: SEASONS[i + 1] };
}

// The term `date` sits in, or — between two terms — the next one to start: where the editable
// window begins.
function currentOrNextTerm(date: string, dates: SemesterDates, schedule: SemesterSchedule) {
  const year = Number(date.slice(0, 4));
  for (const y of [year - 1, year, year + 1]) {
    for (const season of SEASONS) {
      if (date <= termBounds(y, season, dates, schedule).end) return { year: y, season };
    }
  }
  return { year: year + 1, season: "spring" as Season };
}

// A term's dates when the schedule doesn't list it: the same season's latest known entry
// projected into `year` (so an edited pattern carries forward), else the template.
function inheritedRange(
  year: number,
  season: Season,
  dates: SemesterDates,
  known: SemesterSchedule,
): { start: string; end: string } {
  const listed = known.find((t) => t.year === year && t.season === season);
  if (listed) return { start: listed.start, end: listed.end };
  const prior = known.filter((t) => t.season === season && t.year < year).sort((a, b) => b.year - a.year)[0];
  if (prior) return { start: `${year}-${prior.start.slice(5)}`, end: `${year}-${prior.end.slice(5)}` };
  return termBounds(year, season, dates);
}

// The schedule as it should be stored on `today`: finished terms retained (newest PAST_TERMS)
// and the not-yet-finished window topped back up to WINDOW_TERMS by appending at the end.
// Idempotent, so the server can run it on every request and write only when it changes.
export function rollSchedule(
  today: string,
  semesterDates?: unknown,
  semesterSchedule?: unknown,
  count: number = WINDOW_TERMS,
): SemesterSchedule {
  const dates = semesterDatesOf(semesterDates);
  const schedule = scheduleOf(semesterSchedule);
  const past = schedule.filter((t) => t.end < today).slice(-PAST_TERMS);
  let { year, season } = currentOrNextTerm(today, dates, schedule);
  const window: SemesterSchedule = [];
  for (let i = 0; i < count; i++) {
    window.push({ year, season, ...inheritedRange(year, season, dates, [...schedule, ...window]) });
    const next = nextSeason(year, season);
    year = next.year;
    season = next.season;
  }
  return [...past, ...window];
}

export function sameSchedule(a: SemesterSchedule, b: SemesterSchedule): boolean {
  return a.length === b.length &&
    a.every((t, i) => t.year === b[i].year && t.season === b[i].season && t.start === b[i].start && t.end === b[i].end);
}

// What to store when an admin saves the editor's window: their terms, plus the finished ones
// already on file that the window no longer covers (the archives still need those dates).
export function mergeSchedule(incoming: unknown, stored: unknown, today: string): SemesterSchedule {
  const next = scheduleOf(incoming);
  const keys = new Set(next.map((t) => `${t.year}-${t.season}`));
  const past = scheduleOf(stored).filter((t) => t.end < today && !keys.has(`${t.year}-${t.season}`));
  return [...past, ...next].sort((a, b) => a.start.localeCompare(b.start)).slice(-(PAST_TERMS + WINDOW_TERMS));
}

// The recurring template a schedule implies: each season's newest entry as MM-DD. Saved with
// the list so years beyond the window follow the same pattern.
export function scheduleToDates(schedule: SemesterSchedule, fallback: SemesterDates): SemesterDates {
  const out = { ...fallback };
  for (const season of SEASONS) {
    const newest = schedule.filter((t) => t.season === season).sort((a, b) => b.year - a.year)[0];
    if (newest) out[season] = { start: newest.start.slice(5), end: newest.end.slice(5) };
  }
  return out;
}

// Key ("2026-summer") of the most recently *finished* term as of `today` — the term whose
// 동산 편성 the rollover retires. Looks back one year so early-January still finds the
// previous 가을학기. Null only if no term has ever ended before `today` (not reachable with
// real schedules, but keeps the caller total).
export function lastEndedTermKey(today: string, semesterDates?: unknown, semesterSchedule?: unknown): string | null {
  const dates = semesterDatesOf(semesterDates);
  const schedule = scheduleOf(semesterSchedule);
  const year = Number(today.slice(0, 4));
  let best: { key: string; end: string } | null = null;
  for (const y of [year - 1, year]) {
    for (const season of SEASONS) {
      const { end } = termBounds(y, season, dates, schedule);
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
