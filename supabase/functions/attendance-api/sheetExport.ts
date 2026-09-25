// 출석부 → 구글 시트 내보내기. sheetSync.ts(시트 → 출석부)의 반대 방향이다.
//
// 서버에는 구글 계정이 없다 — 시트에 쓸 수 있는 것은 그 시트에 붙은 Apps Script뿐이다.
// 그래서 방향은 **시트가 당긴다**: 스크립트(scripts/sheet-sync/Export.gs)가 몇 분마다
// `/api/sheet/export`를 부르고, 서버는 여기서 만든 표를 JSON으로 내준다. 스크립트는 받은
// 표를 탭에 그대로 옮겨 적기만 한다 — 누구를 담고 어느 칸이 O인지는 전부 여기서 정한다
// (파서를 서버에 둔 것과 같은 이유: 규칙을 고칠 때 시트마다 코드를 다시 붙여넣지 않는다).
//
import { currentSeason, lastEndedTermKey, scheduleOf, semesterDatesOf, termBounds, type Season } from "./term.ts";

// 이 파일은 데이터베이스를 모른다. 명단과 예배 출석 줄이 들어와서 표가 나간다.
//
// 표의 규칙은 출석부 탭과 같다:
//  · 열 = 그 기간에 실제로 예배 출석이 찍힌 날짜 (예배가 없던 주일에 X 열을 세우지 않는다)
//  · 줄 = **동산이 배정된 사람만**, 부서마다 한 블록, 그 안에서 동산 → 이름 순. 운영
//    계정·방문자·동산 미지정은 없다. 끝난 학기는 그 학기의 편성 스냅숏(`subgroups`)으로
//    가른다 — 롤오버가 지금 편성을 비운 뒤라, 지금 값으로 보면 아무도 남지 않는다
//  · 칸 = O · X · 등록일 이전은 빈칸 · 상태 표기(방학·귀국 …)가 덮는 날은 그 말
//  · 떠난 사람(무기한 표기 또는 귀국/이주/졸업)은 그 표기가 표 전체를 덮을 때만 빠진다 —
//    학기 중간에 떠난 사람의 앞쪽 O는 남는다 (web lib/status.ts와 같은 규칙)

export interface ExportMember {
  id: string;
  name: string;
  group_name?: string | null;
  subgroup?: string | null;
  registration_date?: string | null;
  is_staff?: boolean | null;
  status_marks?: unknown;
  status_note?: string | null;
  status_start?: string | null;
  status_end?: string | null;
}

export interface ExportLogRow {
  member_id?: string | null;
  name?: string | null;
  date: string;
  is_guest?: boolean | null;
}

export interface ExportRow {
  name: string;
  subgroup: string;
  cells: string[]; // dates와 같은 길이
  total: number;
}

export interface ExportBlock {
  group: string;
  rows: ExportRow[];
  totals: number[]; // 날짜마다 그 블록의 출석 인원
}

export interface ExportGrid {
  dates: string[];
  blocks: ExportBlock[];
}

interface Mark { note: string; start: string | null; end: string | null }

function marksOf(m: ExportMember): Mark[] {
  const list = Array.isArray(m.status_marks) ? m.status_marks : [];
  // deno-lint-ignore no-explicit-any
  const marks = list.filter((x: any) => x && typeof x.note === "string" && x.note.trim())
    // deno-lint-ignore no-explicit-any
    .map((x: any) => ({ note: String(x.note).trim(), start: x.start || null, end: x.end || null }));
  if (marks.length) return marks;
  if (m.status_note && m.status_note.trim()) {
    return [{ note: m.status_note.trim(), start: m.status_start || null, end: m.status_end || null }];
  }
  return [];
}

function covers(mark: Mark, date: string): boolean {
  if (!mark.start || date < mark.start) return false;
  return !mark.end || date <= mark.end;
}

function isHiding(mark: Mark): boolean {
  const n = mark.note;
  return !mark.end || n.includes("귀국") || n.includes("이주") || n.includes("졸업");
}

/** 부서 블록의 순서 — 출석부와 같다. 모르는 부서는 그 뒤에 이름순. */
const GROUP_ORDER = ["대학부", "청년부"];

function groupRank(g: string): number {
  const i = GROUP_ORDER.indexOf(g);
  return i < 0 ? GROUP_ORDER.length : i;
}

/**
 * 기간 [start, end] 안의 예배 출석을 부서별 표로 만든다.
 * `log`은 예배 줄만(kind='worship') 넘긴다 — 동산모임은 이 표의 사실이 아니다.
 */
export function buildExportGrid(
  members: ExportMember[],
  log: ExportLogRow[],
  window: { start: string; end: string },
  /** 끝난 학기의 편성 (config.dongsan_history[term].subgroups, member id → 동산). 있으면 그것이 유일한 출처다. */
  subgroups?: Record<string, string> | null,
): ExportGrid {
  const inWindow = log.filter((e) => !e.is_guest && e.date >= window.start && e.date <= window.end);
  const dates = [...new Set(inWindow.map((e) => e.date))].sort();

  // 출석 줄 → 사람. memberId가 열쇠이고(동명이인이 갈린다), 없는 옛 줄만 이름으로 되짚는다.
  const byName = new Map<string, string[]>();
  for (const m of members) byName.set(m.name, [...(byName.get(m.name) || []), m.id]);
  const present = new Map<string, Set<string>>(); // member id → dates
  for (const e of inWindow) {
    let id = e.member_id || "";
    if (!id) {
      const ids = byName.get(e.name || "") || [];
      if (ids.length !== 1) continue; // 누구인지 모르는 줄은 아무에게도 붙이지 않는다
      id = ids[0];
    }
    if (!present.has(id)) present.set(id, new Set());
    present.get(id)!.add(e.date);
  }

  const first = dates[0] ?? window.end;
  const last = dates[dates.length - 1] ?? window.end;

  const rowsByGroup = new Map<string, ExportRow[]>();
  for (const m of members) {
    if (m.is_staff) continue;
    // 동산이 배정된 사람만 담는다.
    const subgroup = (subgroups ? subgroups[m.id] : m.subgroup) || "";
    if (!subgroup) continue;
    const marks = marksOf(m);
    const attended = present.get(m.id) ?? new Set<string>();
    // 떠난 사람은 그 표기가 표 전체를 덮을 때만 빠진다.
    if (!attended.size && marks.some((k) => isHiding(k) && covers(k, first) && covers(k, last))) continue;
    // 표가 끝난 뒤에 등록한 사람은 이 기간의 사람이 아니다 (그 사이에 온 적이 없다면).
    const reg = m.registration_date || "";
    if (!attended.size && reg && reg > last) continue;

    const cells = dates.map((d) => {
      if (attended.has(d)) return "O";
      if (reg && d < reg) return "";
      const note = marks.find((k) => covers(k, d))?.note;
      return note ?? "X";
    });
    const group = m.group_name || "";
    const row: ExportRow = { name: m.name, subgroup, cells, total: attended.size };
    rowsByGroup.set(group, [...(rowsByGroup.get(group) || []), row]);
  }

  const blocks = [...rowsByGroup.entries()]
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
    .map(([group, rows]) => {
      rows.sort((a, b) => a.subgroup.localeCompare(b.subgroup) || a.name.localeCompare(b.name));
      const totals = dates.map((_, i) => rows.filter((r) => r.cells[i] === "O").length);
      return { group, rows, totals };
    });

  return { dates, blocks };
}

function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TERM_KEY = /^(\d{4})-(spring|summer|fall)$/;

/**
 * 표가 담는 기간. 출석부 탭이 보여주는 기간과 같다:
 *  · `term`("2026-fall")을 주면 그 학기 (끝나지 않았으면 오늘까지)
 *  · 아니면 지금 학기의 시작 ~ 오늘
 *  · 두 학기 사이(전환 기간)면 지난 학기가 끝난 다음 날 ~ 오늘
 *  · 학기가 없는 부(`usesSemesters=false`, 장년부)는 올해 1월 1일 ~ 오늘
 * 모르는 `term`은 null — 조용히 다른 기간을 내주지 않는다.
 */
export function exportWindow(
  today: string,
  // deno-lint-ignore no-explicit-any
  cfg: any,
  term: string,
  usesSemesters: boolean,
): { start: string; end: string; term: string } | null {
  if (!usesSemesters) return { start: `${today.slice(0, 4)}-01-01`, end: today, term: "" };
  const dates = semesterDatesOf(cfg?.semester_dates);
  const schedule = scheduleOf(cfg?.semester_schedule);
  if (term) {
    const k = term.match(TERM_KEY);
    if (!k) return null;
    const b = termBounds(Number(k[1]), k[2] as Season, dates, schedule);
    if (b.start > today) return null;
    return { start: b.start, end: b.end < today ? b.end : today, term };
  }
  const season = currentSeason(today, cfg?.semester_dates, cfg?.semester_schedule);
  if (season) {
    const b = termBounds(Number(today.slice(0, 4)), season, dates, schedule);
    return { start: b.start, end: today, term: `${today.slice(0, 4)}-${season}` };
  }
  const last = lastEndedTermKey(today, cfg?.semester_dates, cfg?.semester_schedule);
  const k = last?.match(TERM_KEY);
  const start = k ? addDays(termBounds(Number(k[1]), k[2] as Season, dates, schedule).end, 1) : `${today.slice(0, 4)}-01-01`;
  return { start, end: today, term: "" };
}
