// Run with: deno test supabase/functions/attendance-api/sheetSync.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import {
  csvUrl,
  baseName,
  matchPerson,
  mergeSheetMarks,
  nameCounts,
  parseAttendanceSheet,
  parseCsv,
  parseSheetDate,
  parseSheetUrl,
  sameMarks,
  type SheetPerson,
  type StoredMark,
} from "./sheetSync.ts";

// 교회가 실제로 쓰는 시트(2026 대청부 여름동산 출석)에서 까다로운 줄만 골라 옮겨 온 것이다.
// 손으로 지어낸 표가 아니라 진짜 값이라, 여기 있는 모양은 전부 한 번은 일어난 일이다.
const SHEET = [
  ",이름,예배 총 출석,06/07/2026,,06/14/2026,,06/21/2026,,06/28/2026,,07/05/2026,,7/12/2026,",
  ",,,예배,동산모임,예배,동산모임,예배,동산모임,예배,동산모임,예배,동산모임,예배,동산모임",
  "건영동산,최건영,6,O,O,O,O,O,O,O,O,O,O,O,O",
  ",이지현(03),4,X,X,O,O,O,O,O,O,X,X,O,X",
  ",손하진,5,O,O,O,O,O,O,O,O,O,O,이주,",
  ",양세윤,1,한국,,,,,,,,X,X,O,O",
  ",김형준,1,새가족,,,,,,,,,,O,O",
  ",,,,,,,,,,,,,,",
  "총 출석,,,4,4,4,4,4,4,4,4,3,3,4,3",
  ",,,,,,,,,,,,,,",
  ",이름,예배 총 출석,06/07/2026,,06/14/2026,,06/21/2026,,06/28/2026,,07/05/2026,,7/12/2026,",
  ",,,예배,동산모임,예배,동산모임,예배,동산모임,예배,동산모임,예배,동산모임,예배,동산모임",
  "윤서동산,최휘서,4,O,O,O,O,출장,,,,O,O,O,O",
  ",황시연,1,새가족,,O,O,이주(방문자),,,,,,,",
  ",김서현,2,O,O,O,O,X,X,X,X,X,X,X,X",
  ",,,,,,,,,,,,,,",
  "총 출석,,,3,3,3,3,1,1,1,1,2,2,2,2",
  ",,,,,,,,,,,,,,",
  // 시트 맨 아래의 범례. 블록 밖이므로 사람으로 읽히면 안 된다 ('출석'이 멤버가 되어버린다).
  "KEY,,,,,,,,,,,,,,",
  "O,출석,,,,,,,,,,,,,",
  "X,결석,,,,,,,,,,,,,",
  ",기타,,,,,,,,,,,,,",
].join("\n");

const parsed = parseAttendanceSheet(SHEET);
const person = (name: string): SheetPerson => parsed.people.find((p) => p.name === name)!;
const worship = (name: string) =>
  person(name).marks.filter((m) => m.kind === "worship").map((m) => `${m.date}${m.present ? "O" : "X"}`);
const dongsan = (name: string) =>
  person(name).marks.filter((m) => m.kind === "dongsan").map((m) => `${m.date}${m.present ? "O" : "X"}`);

Deno.test("블록을 전부 찾고, 범례는 사람으로 읽지 않는다", () => {
  assertEquals(parsed.warnings, []);
  assertEquals(parsed.people.map((p) => p.name), [
    "최건영", "이지현(03)", "손하진", "양세윤", "김형준", // 건영동산
    "최휘서", "황시연", "김서현", // 윤서동산
  ]);
  // 범례의 '출석'·'결석'·'기타'는 블록 밖이라 애초에 보지 않는다.
  assertEquals(parsed.people.some((p) => p.name === "출석"), false);
});

Deno.test("동산 이름은 세로 병합이라 블록 안에서 이어진다", () => {
  assertEquals(person("최건영").subgroup, "건영동산");
  assertEquals(person("김형준").subgroup, "건영동산"); // A열이 빈 줄
  assertEquals(person("황시연").subgroup, "윤서동산");
});

Deno.test("날짜는 두 칸에 병합되어 있고, 종류는 그 아래 줄이 정한다", () => {
  assertEquals(parsed.dates, [
    "2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28", "2026-07-05", "2026-07-12",
  ]);
  // 같은 날짜의 예배와 동산모임이 서로 다를 수 있다 — 그게 이 연동의 이유다.
  assertEquals(worship("이지현(03)").at(-1), "2026-07-12O");
  assertEquals(dongsan("이지현(03)").at(-1), "2026-07-12X");
});

Deno.test("O도 X도 아닌 글자는 구간을 열고, 다음 값에서 닫힌다", () => {
  // 끝까지 닫히지 않으면 기한 없는 구간 — 앱에서 명단 밖으로 내보내는 표기가 된다.
  assertEquals(person("손하진").spans, [{ note: "이주", start: "2026-07-12", end: null }]);
  // 닫히면 그 구간만 덮는다. 양세윤은 07-05에 X가 나오므로 한국은 06-28에서 끝난다.
  assertEquals(person("양세윤").spans, [{ note: "한국", start: "2026-06-07", end: "2026-06-28" }]);
  assertEquals(worship("양세윤"), ["2026-07-05X", "2026-07-12O"]);
  // 한 사람에게 구간이 여럿일 수 있다.
  assertEquals(person("최휘서").spans, [{ note: "출장", start: "2026-06-21", end: "2026-06-28" }]);
});

Deno.test("빈칸은 결석이 아니다 — 아무 말도 하지 않은 것이라 앱을 건드리지 않는다", () => {
  // 양세윤의 06-07…06-28은 '한국'에 덮여 있어 출석 기록이 하나도 실리지 않는다.
  assertEquals(worship("양세윤").length, 2);
  assertEquals(person("양세윤").marks.some((m) => m.date < "2026-07-05"), false);
});

Deno.test("'새가족'으로 덮인 앞부분은 표기가 아니라 등록일이다", () => {
  assertEquals(person("김형준").spans, []);
  assertEquals(person("김형준").joinedFrom, "2026-07-12");
  // 들어온 뒤에 다시 떠난 사람도 있다: 새가족 → 출석 → 이주.
  assertEquals(person("황시연").joinedFrom, "2026-06-14");
  assertEquals(person("황시연").spans, [{ note: "이주(방문자)", start: "2026-06-21", end: null }]);
});

Deno.test("C열 총계와 어긋나는 줄은 반영하지 않고 시끄럽게 알린다", () => {
  const broken = SHEET.replace(",이지현(03),4,", ",이지현(03),9,");
  const out = parseAttendanceSheet(broken);
  assertEquals(out.people.some((p) => p.name === "이지현(03)"), false);
  assertEquals(out.warnings.length, 1);
  assertEquals(out.warnings[0].includes("이지현(03)"), true);
});

Deno.test("이름은 열쇠가 아니다 — 동산으로 갈리고, 못 가르면 찍지 않는다", () => {
  const roster = [
    { id: "a", name: "김서현", subgroup: "건영동산" },
    { id: "b", name: "김서현", subgroup: "윤서동산" },
    { id: "c", name: "최건영", subgroup: "건영동산" },
  ];
  // 1. 이름 + 동산이 하나면 그 사람.
  assertEquals(matchPerson({ name: "김서현", subgroup: "윤서동산" }, roster, 2), { kind: "matched", id: "b" });
  // 2. 명단에 없으면 새로 만든다.
  assertEquals(matchPerson({ name: "홍길동", subgroup: "윤서동산" }, roster, 1), { kind: "create" });
  // 3. 이름이 명단에 하나뿐이고 시트에도 한 번뿐이면, 동산이 달라도 그 사람이다 (동산을 옮긴 경우).
  assertEquals(matchPerson({ name: "최건영", subgroup: "윤서동산" }, roster, 1), { kind: "matched", id: "c" });
  // 4. 시트에 두 번 나오는데 동산이 안 맞으면 — 두 줄이 한 사람에게 겹쳐 붙는다. 찍지 않는다.
  assertEquals(matchPerson({ name: "김서현", subgroup: "중호동산" }, roster, 2).kind, "ambiguous");
});

Deno.test("명단과 시트가 동명이인을 다르게 갈라 적어도 사람을 새로 만들지 않는다", () => {
  // 실제로 일어난 일이다: 시트는 동산으로 가르고(건영동산 김서현 / 윤서동산 김서현),
  // 명단은 이름에 괄호를 붙여 갈랐다(김서현(대학부) / 김서현(청년부)). 이름만 그대로
  // 맞춰 보면 "없는 이름"이 되어 김서현이 넷으로 늘어난다.
  const roster = [
    { id: "a", name: "김서현(대학부)", subgroup: "" },
    { id: "b", name: "김서현(청년부)", subgroup: "" },
    { id: "c", name: "박시내", subgroup: "" },
  ];
  const out = matchPerson({ name: "김서현", subgroup: "건영동산" }, roster, 2);
  assertEquals(out.kind, "ambiguous");
  assertEquals(out.kind === "ambiguous" && out.reason.includes("김서현(대학부)"), true);
  // 괄호를 뗀 짝이 하나뿐이고 시트에도 한 번뿐이면 그 사람이 맞다.
  assertEquals(
    matchPerson({ name: "박시내", subgroup: "호연동산" }, roster, 1),
    { kind: "matched", id: "c" },
  );
  // 정말 없는 이름은 여전히 새로 만든다.
  assertEquals(matchPerson({ name: "홍길동", subgroup: "호연동산" }, roster, 1), { kind: "create" });
});

Deno.test("괄호를 떼는 것은 찾기 위해서지, 둘을 한 사람으로 보기 위해서가 아니다", () => {
  assertEquals(baseName("김서현(청년부)"), "김서현");
  assertEquals(baseName("이지현(03)"), "이지현");
  assertEquals(baseName("최건영"), "최건영");
  // 명단에 이지현(03)·이지현(06)이 둘 다 있고 시트가 그냥 '이지현'이라 적었으면 찍지 않는다.
  const roster = [
    { id: "x", name: "이지현(03)", subgroup: "지현(03)희중" },
    { id: "y", name: "이지현(06)", subgroup: "예상지현(06)" },
  ];
  assertEquals(matchPerson({ name: "이지현", subgroup: "건영동산" }, roster, 1).kind, "ambiguous");
  // 시트가 명단과 똑같이 적었으면 그대로 붙는다.
  assertEquals(matchPerson({ name: "이지현(03)", subgroup: "건영동산" }, roster, 1), { kind: "matched", id: "x" });
});

Deno.test("시트 안의 동명이인을 센다", () => {
  assertEquals(nameCounts(parsed.people).get("김서현"), 1);
  assertEquals(nameCounts(parsed.people).get("최건영"), 1);
});

Deno.test("상태 표기는 시트 것만 갈아 끼우고 사람이 적은 것은 그대로 둔다", () => {
  const existing: StoredMark[] = [
    { note: "방학", start: "2026-06-01", end: "2026-08-01" }, // 관리자가 앱에서 적은 것
    { note: "출장", start: "2026-05-01", end: "2026-05-08", source: "sheet" }, // 지난번 동기화
  ];
  const merged = mergeSheetMarks(existing, [{ note: "이주", start: "2026-07-12", end: null }]);
  assertEquals(merged, [
    { note: "방학", start: "2026-06-01", end: "2026-08-01" },
    { note: "이주", start: "2026-07-12", end: null, source: "sheet" },
  ]);
  // 시트에서 표기가 사라지면 시트가 붙였던 것도 같이 사라진다.
  assertEquals(mergeSheetMarks(existing, []), [{ note: "방학", start: "2026-06-01", end: "2026-08-01" }]);
});

Deno.test("바뀐 것이 없으면 쓰지 않는다", () => {
  const a: StoredMark[] = [{ note: "이주", start: "2026-07-12", end: null, source: "sheet" }];
  assertEquals(sameMarks(a, [{ note: "이주", start: "2026-07-12", end: null, source: "sheet" }]), true);
  assertEquals(sameMarks(a, [{ note: "이주", start: "2026-07-19", end: null, source: "sheet" }]), false);
  assertEquals(sameMarks(a, []), false);
});

Deno.test("날짜 표기는 시트가 쓰는 대로 읽는다", () => {
  assertEquals(parseSheetDate("06/07/2026"), "2026-06-07");
  assertEquals(parseSheetDate("7/26/2026"), "2026-07-26"); // 앞의 0이 없는 줄도 섞여 있다
  assertEquals(parseSheetDate("2026-06-07"), "2026-06-07");
  assertEquals(parseSheetDate("예배 총 출석"), null);
  assertEquals(parseSheetDate(""), null);
});

Deno.test("따옴표 안의 쉼표와 줄바꿈", () => {
  assertEquals(parseCsv('a,"b,c",d\n1,"2\n3",4'), [["a", "b,c", "d"], ["1", "2\n3", "4"]]);
  assertEquals(parseCsv('"He said ""hi"""'), [['He said "hi"']]);
});

Deno.test("공유 링크에서 시트 주소를 뽑는다", () => {
  assertEquals(
    parseSheetUrl("https://docs.google.com/spreadsheets/d/1h-yZx96AZ1ikKMP726B9iJUUfvHdCgrfqlKG4yCCw-I/edit?usp=sharing"),
    { id: "1h-yZx96AZ1ikKMP726B9iJUUfvHdCgrfqlKG4yCCw-I", gid: "" },
  );
  assertEquals(
    parseSheetUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=847362")?.gid,
    "847362",
  );
  assertEquals(parseSheetUrl("https://example.com/nope"), null);
  assertEquals(csvUrl("ABC123", "847362"), "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=847362");
});
