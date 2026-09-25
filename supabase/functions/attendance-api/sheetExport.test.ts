// Run with: deno test supabase/functions/attendance-api/sheetExport.test.ts
import { assertEquals } from "jsr:@std/assert";
import { buildExportGrid, exportWindow, type ExportMember } from "./sheetExport.ts";

const W = { start: "2026-08-16", end: "2026-12-20" };
const m = (id: string, extra: Partial<ExportMember> = {}): ExportMember => ({
  id, name: id, group_name: "대학부", subgroup: "호연동산", ...extra,
});

Deno.test("columns are the dates that actually had worship attendance, inside the window", () => {
  const g = buildExportGrid([m("a")], [
    { member_id: "a", date: "2026-08-09" }, // 창 밖
    { member_id: "a", date: "2026-08-23" },
    { member_id: "a", date: "2026-08-16" },
  ], W);
  assertEquals(g.dates, ["2026-08-16", "2026-08-23"]);
  assertEquals(g.blocks[0].rows[0].cells, ["O", "O"]);
  assertEquals(g.blocks[0].rows[0].total, 2);
});

Deno.test("O / X / blank before registration / status note", () => {
  const members = [
    m("a"),
    m("new", { registration_date: "2026-08-23" }),
    m("brk", { status_marks: [{ note: "방학", start: "2026-08-23", end: "2026-08-30" }] }),
  ];
  const log = [
    { member_id: "a", date: "2026-08-16" },
    { member_id: "new", date: "2026-08-30" },
    { member_id: "a", date: "2026-08-23" },
    { member_id: "a", date: "2026-08-30" },
  ];
  const rows = buildExportGrid(members, log, W).blocks[0].rows;
  const byName = Object.fromEntries(rows.map((r) => [r.name, r.cells]));
  assertEquals(byName.a, ["O", "O", "O"]);
  assertEquals(byName.new, ["", "X", "O"]);
  assertEquals(byName.brk, ["X", "방학", "방학"]);
});

Deno.test("blocks go 대학부 → 청년부, 동산 then name; 동산 미지정, staff and guests are out", () => {
  const members = [
    m("z", { group_name: "청년부", subgroup: "민서동산" }),
    m("b", { subgroup: "" }),
    m("c", { subgroup: "호연동산" }),
    m("a", { subgroup: "호연동산" }),
    m("staff", { is_staff: true }),
  ];
  const log = [
    { member_id: "a", date: "2026-08-16" },
    { name: "손님", date: "2026-08-16", is_guest: true },
  ];
  const g = buildExportGrid(members, log, W);
  assertEquals(g.blocks.map((b) => b.group), ["대학부", "청년부"]);
  assertEquals(g.blocks[0].rows.map((r) => r.name), ["a", "c"]);
  assertEquals(g.blocks[0].totals, [1]);
});

Deno.test("a departed member drops out only when the mark covers the whole sheet", () => {
  const members = [
    m("gone", { status_marks: [{ note: "한국 귀국", start: "2026-08-01", end: null }] }),
    m("midterm", { status_marks: [{ note: "이주", start: "2026-08-23", end: null }] }),
    m("a"),
  ];
  const log = [
    { member_id: "a", date: "2026-08-16" },
    { member_id: "a", date: "2026-08-23" },
  ];
  const rows = buildExportGrid(members, log, W).blocks[0].rows;
  assertEquals(rows.map((r) => r.name), ["a", "midterm"]);
  assertEquals(rows[1].cells, ["X", "이주"]);
});

Deno.test("rows without memberId are matched by a unique name only", () => {
  const members = [m("김서현(대학부)"), { ...m("dup1"), name: "이름" }, { ...m("dup2"), name: "이름" }];
  const log = [
    { name: "김서현(대학부)", date: "2026-08-16" },
    { name: "이름", date: "2026-08-16" },
  ];
  const rows = buildExportGrid(members, log, W).blocks[0].rows;
  const byId = Object.fromEntries(rows.map((r) => [r.name + r.cells.join(), r.total]));
  assertEquals(byId["김서현(대학부)O"], 1);
  assertEquals(rows.filter((r) => r.name === "이름").every((r) => r.total === 0), true);
});

Deno.test("someone who joined after the sheet ends is not on it", () => {
  const rows = buildExportGrid([m("a"), m("later", { registration_date: "2026-09-01" })],
    [{ member_id: "a", date: "2026-08-16" }], W).blocks[0].rows;
  assertEquals(rows.map((r) => r.name), ["a"]);
});

const CFG = { semester_schedule: [
  { year: 2026, season: "summer", start: "2026-05-17", end: "2026-08-02" },
  { year: 2026, season: "fall", start: "2026-08-16", end: "2026-12-20" },
] };

Deno.test("window: current term runs to today", () => {
  assertEquals(exportWindow("2026-09-25", CFG, "", true), { start: "2026-08-16", end: "2026-09-25", term: "2026-fall" });
});
Deno.test("window: a named past term is the whole term", () => {
  assertEquals(exportWindow("2026-09-25", CFG, "2026-summer", true), { start: "2026-05-17", end: "2026-08-02", term: "2026-summer" });
});
Deno.test("window: between terms starts the day after the last one ended", () => {
  assertEquals(exportWindow("2026-08-09", CFG, "", true)?.start, "2026-08-03");
});
Deno.test("window: unknown or future term is refused, not swapped", () => {
  assertEquals(exportWindow("2026-09-25", CFG, "fall", true), null);
  assertEquals(exportWindow("2026-09-25", CFG, "2027-spring", true), null);
});
Deno.test("window: a partition without terms gets the calendar year", () => {
  assertEquals(exportWindow("2026-09-25", {}, "", false), { start: "2026-01-01", end: "2026-09-25", term: "" });
});

Deno.test("a finished term is split by its snapshot, not the live (cleared) 동산", () => {
  const members = [m("a", { subgroup: "" }), m("b", { subgroup: "" }), m("c", { subgroup: "새동산" })];
  const g = buildExportGrid(members, [{ member_id: "a", date: "2026-06-07" }],
    { start: "2026-05-17", end: "2026-08-02" }, { a: "건영동산", b: "중호동산" });
  assertEquals(g.blocks[0].rows.map((r) => [r.name, r.subgroup]), [["a", "건영동산"], ["b", "중호동산"]]);
});
