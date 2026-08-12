// 동산 출석 구글 시트를 읽어 출석부가 쓸 수 있는 모양으로 바꾼다.
//
// 시트는 교회가 실제로 쓰고 있는 그 파일이고, 앱을 위해 만들어진 것이 아니다. 그러니
// **시트를 앱에 맞추는 것이 아니라 앱이 시트를 읽는다.** 이 파일은 그 읽기 전부이고,
// 데이터베이스를 모른다 — 문자열(CSV)이 들어와서 사실(누가·언제·무엇에 왔다)이 나간다.
// 그래야 시트가 조금 달라질 때마다 서버를 뜯지 않고 여기에 테스트를 한 줄 더 쓸 수 있다.
//
// ── 시트의 모양 ───────────────────────────────────────────────────────────────────────
// 한 탭에 동산 블록이 세로로 쌓인다. 블록 하나는 이렇게 생겼다:
//
//        A          B            C          D        E         F        G      …
//   1              이름     예배 총 출석  06/07/2026        06/14/2026          ← 날짜(2칸 병합)
//   2                                     예배    동산모임    예배   동산모임    ← 종류
//   3  건영동산    최건영         9        O        O         O       O
//   4              권상운         8        O        O         O       O
//   …
//  18  총 출석                              8        9         8       8        ← 블록 끝
//
// · 동산 이름(A)은 블록의 첫 줄에만 있다(세로 병합) → 아래로 이어진다.
// · 날짜는 예배/동산모임 두 칸에 걸쳐 병합되어 있다 → CSV에서는 왼쪽 칸에만 값이 있다.
// · 칸의 값은 O(출석) · X(결석) · 빈칸 · **그 밖의 아무 글자**다. 마지막 것이 중요하다:
//   회색으로 병합해 놓은 `이주` · `한국 귀국` · `출장` · `여행` · `전역` · `새가족` 같은
//   말이 그 사람의 그 기간을 덮는다. CSV에는 병합의 왼쪽 칸에만 그 말이 있고 나머지는
//   빈칸으로 온다 — 그래서 **"글자가 나오면 구간이 열리고, 다음에 값이 나오는 칸에서
//   닫힌다"** 가 병합을 되살리는 규칙이 된다. 끝까지 닫히지 않으면 기한 없는 구간이다.
// · 빈칸은 결석이 아니다. 아직 아무도 적지 않았다는 뜻이라 앱을 건드리지 않는다.
//   (시트 KEY 범례가 그렇게 적어 두었다: O 출석 / X 결석 / 빈칸 기타.)
//
// ── 틀렸는지 어떻게 아는가 ────────────────────────────────────────────────────────────
// C열 `예배 총 출석`은 시트가 스스로 센 예배 출석 수다. 우리가 센 수와 다르면 우리가
// 시트를 잘못 읽은 것이다 — 그런 줄은 `warnings`로 올라오고, 그 사람은 반영하지 않는다.
// 파서가 조용히 어긋나서 출석부에 틀린 O를 남기는 것보다, 시끄럽게 멈추는 편이 낫다.

export type AttendanceKind = "worship" | "dongsan";

/** 한 사람의 한 칸 — "이 날짜의 이 모임에 왔다/안 왔다". 빈칸은 아예 실리지 않는다. */
export interface SheetMark {
  date: string; // ISO
  kind: AttendanceKind;
  present: boolean;
}

/** 회색 병합 구간 하나. end가 null이면 시트 끝까지 닫히지 않은 것 = 기한 없음. */
export interface SheetSpan {
  note: string;
  start: string; // ISO
  end: string | null; // ISO, 포함
}

export interface SheetPerson {
  name: string;
  subgroup: string; // 동산(장년부라면 셀)
  marks: SheetMark[];
  spans: SheetSpan[];
  /** 새가족 구간이 끝난 바로 다음 날짜 — 이 사람이 명단에 들어온 날. 없으면 null. */
  joinedFrom: string | null;
  /** C열이 말한 예배 출석 수. 우리가 센 것과 다르면 이 사람은 버려진다. */
  declaredTotal: number | null;
  countedTotal: number;
}

export interface ParsedSheet {
  dates: string[];
  people: SheetPerson[];
  /** 사람 단위로 버려진 것 + 읽다가 이상했던 것. 관리자 화면에 그대로 보여준다. */
  warnings: string[];
}

// ── 값 읽기 ──────────────────────────────────────────────────────────────────────────

const PRESENT = new Set(["o", "0", "○", "●", "ㅇ", "v", "✓", "✔", "y"]);
const ABSENT = new Set(["x", "✗", "✘", "ㅌ", "n"]);

// "새가족"으로 덮인 앞부분은 상태 표기가 아니다 — 그 사람이 **아직 오기 전**이라는 뜻이라
// 앱에서는 등록일자가 그것을 말한다. (앱에는 이미 새가족이라는 다른 뜻의 개념이 있다.)
const JOIN_NOTES = ["새가족", "새신자", "신규"];

function isJoinNote(note: string): boolean {
  const n = note.replace(/\s+/g, "");
  return JOIN_NOTES.some((j) => n.includes(j));
}

/** 시트 칸 하나를 O/X/빈칸/그 밖의 글자 중 하나로 읽는다. */
function readCell(raw: string): "present" | "absent" | "blank" | "note" {
  const v = raw.trim();
  if (!v) return "blank";
  const low = v.toLowerCase();
  if (PRESENT.has(low)) return "present";
  if (ABSENT.has(low)) return "absent";
  return "note";
}

/** "06/07/2026" · "7/26/2026" · "2026-06-07" → "2026-06-07". 못 읽으면 null. */
export function parseSheetDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
  const us = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (us) return `${us[3]}-${pad(us[1])}-${pad(us[2])}`;
  return null;
}

function pad(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────

/**
 * RFC4180 CSV → 2차원 배열. 구글의 export?format=csv가 내주는 것만 다루면 되므로
 * 따옴표 안의 쉼표·줄바꿈·이중따옴표까지만 본다.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, ""); // 구글이 붙이는 BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── 시트 읽기 ────────────────────────────────────────────────────────────────────────

const NAME_HEADER = "이름";
const TOTAL_LABEL = "총 출석";
// 장년부는 같은 칸을 "셀모임"이라 부른다 — 데이터는 같으므로 둘 다 받는다.
const DONGSAN_HEADERS = ["동산모임", "셀모임", "동산 모임", "셀 모임"];
const WORSHIP_HEADERS = ["예배", "주일예배", "주일 예배"];

function norm(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => !norm(c));
}

interface ColumnPlan {
  index: number;
  date: string;
  kind: AttendanceKind;
}

/**
 * 머리글 두 줄(날짜 / 예배·동산모임)에서 "몇 번째 칸이 언제의 무엇인가"를 뽑는다.
 * 날짜는 두 칸에 병합되어 있으므로 왼쪽으로 거슬러 올라가 찾는다.
 */
function planColumns(dateRow: string[], kindRow: string[], warnings: string[]): ColumnPlan[] {
  const plans: ColumnPlan[] = [];
  const width = Math.max(dateRow.length, kindRow.length);
  let carried: string | null = null;
  for (let c = 0; c < width; c++) {
    const here = parseSheetDate(dateRow[c] ?? "");
    if (here) carried = here;
    const label = norm(kindRow[c]);
    if (!label) continue;
    const kind: AttendanceKind | null = WORSHIP_HEADERS.includes(label)
      ? "worship"
      : DONGSAN_HEADERS.includes(label)
      ? "dongsan"
      : null;
    if (!kind) continue;
    if (!carried) {
      warnings.push(`머리글에 날짜 없이 '${label}' 칸이 있습니다 (${c + 1}번째 칸) — 건너뜁니다.`);
      continue;
    }
    plans.push({ index: c, date: carried, kind });
  }
  return plans;
}

/** 이 줄이 블록의 머리글(이름 + 예배/동산모임)인가? */
function headerAt(rows: string[][], r: number): { nameCol: number; kindRow: string[] } | null {
  const row = rows[r];
  const next = rows[r + 1];
  if (!row || !next) return null;
  const nameCol = row.findIndex((c) => norm(c) === NAME_HEADER);
  if (nameCol < 0) return null;
  const hasKinds = next.some((c) => {
    const v = norm(c);
    return WORSHIP_HEADERS.includes(v) || DONGSAN_HEADERS.includes(v);
  });
  return hasKinds ? { nameCol, kindRow: next } : null;
}

/**
 * 시트 한 탭(CSV) → 사람들. 블록을 위에서부터 훑고, 블록 안의 줄만 사람으로 읽는다.
 * 블록 밖(맨 아래 KEY 범례 같은 것)은 애초에 보지 않으므로 "출석"이 사람 이름이 되는
 * 일이 생기지 않는다.
 */
export function parseAttendanceSheet(csv: string): ParsedSheet {
  const rows = parseCsv(csv);
  const warnings: string[] = [];
  const people: SheetPerson[] = [];
  const dates = new Set<string>();

  let r = 0;
  while (r < rows.length) {
    const head = headerAt(rows, r);
    if (!head) { r++; continue; }
    const cols = planColumns(rows[r], head.kindRow, warnings);
    for (const c of cols) dates.add(c.date);
    // C열(총계)은 머리글에 종류가 없어 cols에 들어오지 않는다. 이름 칸 바로 오른쪽에서
    // 첫 데이터 칸 사이에 있는 칸을 총계로 본다.
    const firstData = cols.length ? cols[0].index : head.nameCol + 1;
    const totalCol = firstData - 1 > head.nameCol ? firstData - 1 : -1;
    const subgroupCol = head.nameCol - 1;

    let subgroup = "";
    let rr = r + 2;
    for (; rr < rows.length; rr++) {
      const row = rows[rr];
      if (isBlankRow(row)) break; // 빈 줄이 블록을 닫는다
      const lead = norm(row[0]);
      if (lead.startsWith(TOTAL_LABEL)) break; // 합계 줄도 블록을 닫는다
      if (headerAt(rows, rr)) break; // 다음 블록이 바로 붙어 있는 경우
      if (subgroupCol >= 0) {
        const s = norm(row[subgroupCol]);
        if (s) subgroup = s;
      }
      const name = norm(row[head.nameCol]);
      if (!name) continue;
      const person = readPerson(name, subgroup, row, cols, totalCol);
      if (person.declaredTotal !== null && person.declaredTotal !== person.countedTotal) {
        warnings.push(
          `${subgroup ? subgroup + " " : ""}${name}: 시트의 예배 총 출석은 ${person.declaredTotal}인데 ` +
            `읽어낸 것은 ${person.countedTotal}입니다 — 이 사람은 반영하지 않았습니다.`,
        );
        continue;
      }
      people.push(person);
    }
    r = rr;
  }

  if (!people.length) warnings.push("시트에서 출석 블록을 하나도 찾지 못했습니다.");
  return { dates: [...dates].sort(), people, warnings };
}

function readPerson(
  name: string,
  subgroup: string,
  row: string[],
  cols: ColumnPlan[],
  totalCol: number,
): SheetPerson {
  const marks: SheetMark[] = [];
  const spans: SheetSpan[] = [];
  let joinedFrom: string | null = null;
  let open: { note: string; start: string } | null = null;
  let prevDate: string | null = null;
  let counted = 0;

  // 열린 구간을 닫는다. 끝나는 날짜는 **직전에 지나온 칸의 날짜** — 병합이 거기까지
  // 덮고 있었다는 뜻이다. 닫은 계기가 된 칸의 날짜(closedAt)는 새가족 구간에서
  // "그날부터 명단에 있다"는 등록일이 된다.
  const close = (closedAt: string | null) => {
    if (!open) return;
    const end = prevDate ?? open.start;
    if (isJoinNote(open.note)) {
      if (closedAt) joinedFrom = closedAt;
    } else {
      spans.push({ note: open.note, start: open.start, end: closedAt ? end : null });
    }
    open = null;
  };

  for (const col of cols) {
    const raw = row[col.index] ?? "";
    const cell = readCell(raw);
    if (cell === "blank") { prevDate = col.date; continue; } // 구간이 열려 있으면 계속 덮는다
    if (cell === "note") {
      close(col.date);
      open = { note: norm(raw), start: col.date };
      prevDate = col.date;
      continue;
    }
    close(col.date);
    const present = cell === "present";
    marks.push({ date: col.date, kind: col.kind, present });
    if (present && col.kind === "worship") counted++;
    prevDate = col.date;
  }
  close(null); // 끝까지 안 닫힌 구간 = 기한 없음

  const declaredRaw = totalCol >= 0 ? norm(row[totalCol]) : "";
  const declaredTotal = /^\d+$/.test(declaredRaw) ? Number(declaredRaw) : null;

  return { name, subgroup, marks, spans, joinedFrom, declaredTotal, countedTotal: counted };
}

// ── 이름 맞추기 ──────────────────────────────────────────────────────────────────────

/** 명단 쪽에서 이름 맞추기에 필요한 만큼만. */
export interface RosterCandidate {
  id: string;
  name: string;
  subgroup: string | null;
}

export type MatchResult =
  | { kind: "matched"; id: string }
  | { kind: "create" }
  | { kind: "ambiguous"; reason: string };

/**
 * 시트의 한 줄을 명단의 한 사람에게 붙인다.
 *
 * 이름만으로는 열쇠가 되지 않는다 — 이 시트에는 `김서현`이 서로 다른 동산에 둘 있고
 * `이지현(03)`/`이지현(06)`처럼 사람이 직접 갈라 적어 둔 이름도 있다. 그래서
 *   1. 같은 이름 + 같은 동산이 딱 하나면 그 사람,
 *   2. 아니면 같은 이름이 명단 전체에 딱 하나이고 **시트에도 그 이름이 한 번뿐일 때만** 그 사람
 *      (시트에 두 번 나오는데 명단에 하나뿐이면 두 줄이 한 사람에게 겹쳐 붙는다 — 그건 틀린 답이다),
 *   3. 없으면 새로 만들고,
 *   4. 둘 이상이면 **찍지 않는다.** 사람에게 물어보는 편이 낫다.
 */
export function matchPerson(
  person: Pick<SheetPerson, "name" | "subgroup">,
  roster: RosterCandidate[],
  occurrencesInSheet: number,
): MatchResult {
  const same = roster.filter((m) => norm(m.name) === norm(person.name));
  if (!same.length) {
    // 이름이 그대로 없다고 해서 없는 사람이 아니다 — **두 곳이 동명이인을 서로 다르게
    // 갈라 적기 때문이다.** 시트는 동산으로 가르고(건영동산 김서현 / 윤서동산 김서현),
    // 명단은 이름에 괄호를 붙여 가른다(김서현(대학부) / 김서현(청년부)). 괄호를 떼고
    // 다시 찾아보지 않으면 이미 있는 사람을 새로 만들어 명단에 김서현이 넷이 된다.
    const base = baseName(person.name);
    const kin = roster.filter((m) => baseName(m.name) === base);
    if (kin.length === 1 && occurrencesInSheet === 1) return { kind: "matched", id: kin[0].id };
    if (kin.length) {
      return {
        kind: "ambiguous",
        reason: `명단에는 '${kin.map((m) => m.name).join("', '")}'이(가) 있는데 시트에는 '${person.name}'입니다 — ` +
          `어느 쪽인지 확실하지 않아 그대로 두었습니다. 시트의 이름을 명단과 같게 적어 주세요.`,
      };
    }
    return { kind: "create" };
  }

  const inSubgroup = same.filter((m) => norm(m.subgroup ?? "") === norm(person.subgroup));
  if (inSubgroup.length === 1) return { kind: "matched", id: inSubgroup[0].id };
  if (inSubgroup.length > 1) {
    return { kind: "ambiguous", reason: `명단에 '${person.name}'이(가) ${person.subgroup}에만 ${inSubgroup.length}명 있습니다.` };
  }

  if (occurrencesInSheet > 1) {
    return {
      kind: "ambiguous",
      reason: `시트에 '${person.name}'이(가) ${occurrencesInSheet}번 나오는데 명단의 동산과 맞는 사람이 없습니다.`,
    };
  }
  if (same.length === 1) return { kind: "matched", id: same[0].id };
  return { kind: "ambiguous", reason: `명단에 '${person.name}'이(가) ${same.length}명 있습니다.` };
}

/**
 * 이름 뒤에 사람이 붙여 둔 구분자를 뗀 것 — "김서현(청년부)" → "김서현", "이지현(03)" → "이지현".
 * 명단과 시트가 동명이인을 서로 다른 방식으로 가를 때 둘을 같은 자리에 놓고 보기 위한 것이지,
 * 이것만으로 사람을 정하지는 않는다 (그러면 이지현(03)과 이지현(06)이 한 사람이 된다).
 */
export function baseName(name: string): string {
  return norm(name).replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
}

/** 시트 안에서 각 이름이 몇 번 나오는지 (동명이인 판정에 쓴다). */
export function nameCounts(people: SheetPerson[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of people) {
    const key = norm(p.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ── 상태 표기 합치기 ─────────────────────────────────────────────────────────────────

export interface StoredMark {
  note: string;
  start: string | null;
  end: string | null;
  source?: string;
}

/**
 * 시트가 말한 구간을 멤버의 status_marks에 얹는다.
 *
 * 시트에서 온 것만 갈아 끼우고 (source:'sheet'), 사람이 앱에서 손으로 적은 표기는
 * 그대로 둔다. 그래야 시트에서 `이주`를 지웠을 때 그 표기가 사라지면서도, 관리자가
 * 앱에서 붙여 둔 `방학`은 동기화 때문에 없어지지 않는다.
 */
export function normalizeMarks(existing: unknown): StoredMark[] {
  return (Array.isArray(existing) ? existing : [])
    .filter((m): m is StoredMark => !!m && typeof (m as StoredMark).note === "string");
}

export function mergeSheetMarks(existing: unknown, spans: SheetSpan[]): StoredMark[] {
  const kept = normalizeMarks(existing).filter((m) => m.source !== "sheet");
  const fromSheet: StoredMark[] = spans.map((s) => ({
    note: s.note,
    start: s.start,
    end: s.end,
    source: "sheet",
  }));
  return [...kept, ...fromSheet];
}

/** 두 표기 목록이 같은가 — 같으면 쓰기를 건너뛴다(쓸데없는 갱신을 막는다). */
export function sameMarks(a: StoredMark[], b: StoredMark[]): boolean {
  const key = (m: StoredMark) => `${m.note}|${m.start ?? ""}|${m.end ?? ""}|${m.source ?? ""}`;
  if (a.length !== b.length) return false;
  const as = a.map(key).sort();
  const bs = b.map(key).sort();
  return as.every((v, i) => v === bs[i]);
}

// ── 시트 주소 ────────────────────────────────────────────────────────────────────────

/** 공유 링크에서 스프레드시트 id와 탭 gid를 뽑는다. */
export function parseSheetUrl(url: string): { id: string; gid: string } | null {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!id) return null;
  const gid = url.match(/[#&?]gid=(\d+)/);
  return { id: id[1], gid: gid ? gid[1] : "" };
}

/** 그 탭을 CSV로 내려받는 주소. 링크 공개(보기 권한)면 열쇠 없이 읽힌다. */
export function csvUrl(id: string, gid: string): string {
  const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}
