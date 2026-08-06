// Run with: deno test supabase/functions/attendance-api/term.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_SEMESTER_DATES,
  currentSeason,
  isSummerTerm,
  lastEndedTermKey,
  mergeSchedule,
  rollSchedule,
  sameSchedule,
  scheduleToDates,
  semesterDatesOf,
  subgroupSnapshot,
  trimHistory,
  validSchedule,
  type DongsanHistory,
  type SemesterDates,
} from "./term.ts";

// The church's saved schedule — terms with real breaks between them.
const saved: SemesterDates = {
  spring: { start: "01-01", end: "05-09" },
  summer: { start: "06-07", end: "08-08" },
  fall: { start: "09-06", end: "12-13" },
};

Deno.test("semesterDatesOf falls back to the defaults for anything unusable", () => {
  assertEquals(semesterDatesOf(saved), saved);
  assertEquals(semesterDatesOf(null), DEFAULT_SEMESTER_DATES);
  assertEquals(semesterDatesOf({ spring: { start: "01-01" } }), DEFAULT_SEMESTER_DATES);
  assertEquals(semesterDatesOf({ ...saved, summer: { start: "bad", end: "08-08" } }), DEFAULT_SEMESTER_DATES);
});

Deno.test("여름 모드 is on for exactly the 여름학기, no toggle involved", () => {
  assertEquals(isSummerTerm("2026-06-06", saved), false); // the day before it opens
  assertEquals(isSummerTerm("2026-06-07", saved), true); // first day
  assertEquals(isSummerTerm("2026-08-08", saved), true); // last day
  assertEquals(isSummerTerm("2026-08-09", saved), false); // off the day after it ends
  assertEquals(isSummerTerm("2026-11-01", saved), false);
  // Same story a year later — the saved MM-DD projects into every year.
  assertEquals(isSummerTerm("2027-07-01", saved), true);
  // With no saved schedule the defaults apply (여름 05-10 ~ 08-14).
  assertEquals(isSummerTerm("2026-08-05", null), true);
  assertEquals(isSummerTerm("2026-08-15", null), false);
});

Deno.test("currentSeason names the running term, null inside a gap", () => {
  assertEquals(currentSeason("2026-03-01", saved), "spring");
  assertEquals(currentSeason("2026-07-01", saved), "summer");
  assertEquals(currentSeason("2026-10-01", saved), "fall");
  assertEquals(currentSeason("2026-05-20", saved), null); // 봄→여름 사이
  assertEquals(currentSeason("2026-08-20", saved), null); // 여름→가을 사이
});

Deno.test("lastEndedTermKey is the term whose 동산 편성 the rollover retires", () => {
  // Inside 여름학기 the most recently finished term is still 봄학기.
  assertEquals(lastEndedTermKey("2026-08-05", saved), "2026-spring");
  // A term that ends today has not ended yet — the wipe waits for the next day.
  assertEquals(lastEndedTermKey("2026-08-08", saved), "2026-spring");
  assertEquals(lastEndedTermKey("2026-08-09", saved), "2026-summer");
  // Inside 가을학기, and after it.
  assertEquals(lastEndedTermKey("2026-10-01", saved), "2026-summer");
  assertEquals(lastEndedTermKey("2026-12-14", saved), "2026-fall");
  // Early January still reaches back to last year's 가을학기.
  assertEquals(lastEndedTermKey("2027-01-02", saved), "2026-fall");
});

Deno.test("rollSchedule seeds two years of terms from the template", () => {
  const seeded = rollSchedule("2026-08-05", saved, []);
  assertEquals(seeded.length, 6);
  assertEquals(seeded[0], { year: 2026, season: "fall", start: "2026-09-06", end: "2026-12-13" });
  assertEquals(seeded[5], { year: 2028, season: "summer", start: "2028-06-07", end: "2028-08-08" });
  // Idempotent: rolling an already-rolled schedule on the same day changes nothing.
  assertEquals(sameSchedule(rollSchedule("2026-08-05", saved, seeded), seeded), true);
});

Deno.test("a finished term leaves the window, a fresh one is appended, and the old one is kept", () => {
  const seeded = rollSchedule("2026-08-05", saved, []);
  const after = rollSchedule("2026-12-14", saved, seeded); // 가을학기가 끝난 다음 날
  const window = after.filter((t) => t.end >= "2026-12-14");
  assertEquals(window.length, 6);
  assertEquals(`${window[0].year}-${window[0].season}`, "2027-spring"); // 하나씩 앞으로
  assertEquals(`${window[5].year}-${window[5].season}`, "2028-fall"); // 맨 뒤에 새 학기
  // 끝난 학기는 목록에 남는다 — 지난 학기 출석부가 그 날짜를 쓴다.
  assertEquals(after.some((t) => t.year === 2026 && t.season === "fall"), true);
});

Deno.test("stored terms keep their dates; appended ones inherit the newest pattern", () => {
  const seeded = rollSchedule("2026-08-05", saved, []);
  const edited = seeded.map((t) => (t.year === 2028 && t.season === "summer" ? { ...t, end: "2028-08-20" } : t));
  // An already-listed term is never rewritten by a roll.
  assertEquals(rollSchedule("2026-10-01", saved, edited).find((t) => t.year === 2028 && t.season === "summer")?.end, "2028-08-20");
  // A newly appended term follows the latest same-season dates rather than the template.
  assertEquals(rollSchedule("2028-08-21", saved, edited).find((t) => t.year === 2029 && t.season === "summer")?.end, "2029-08-20");
});

Deno.test("mergeSchedule keeps finished terms the saved window no longer covers", () => {
  const seeded = rollSchedule("2026-08-05", saved, []);
  const after = rollSchedule("2026-12-14", saved, seeded);
  const window = after.filter((t) => t.end >= "2026-12-14");
  const merged = mergeSchedule(window, after, "2026-12-14");
  assertEquals(merged.some((t) => t.year === 2026 && t.season === "fall"), true);
  assertEquals(merged.length, after.length);
});

Deno.test("validSchedule rejects backwards or overlapping terms", () => {
  assertEquals(validSchedule(rollSchedule("2026-08-05", saved, [])), true);
  assertEquals(validSchedule([]), false);
  assertEquals(validSchedule([{ year: 2026, season: "fall", start: "2026-09-06", end: "2026-09-01" }]), false);
  assertEquals(
    validSchedule([
      { year: 2026, season: "fall", start: "2026-09-06", end: "2026-12-13" },
      { year: 2027, season: "spring", start: "2026-12-01", end: "2027-05-09" },
    ]),
    false,
  );
});

Deno.test("the schedule wins over the template for 여름 모드 and the rollover key", () => {
  const longSummer = [{ year: 2027, season: "summer" as const, start: "2027-06-07", end: "2027-08-20" }];
  assertEquals(isSummerTerm("2027-08-15", saved, longSummer), true);
  assertEquals(isSummerTerm("2027-08-15", saved, []), false); // template ends 08-08
  assertEquals(lastEndedTermKey("2027-08-21", saved, longSummer), "2027-summer");
  // The template a schedule implies — each season's newest entry as MM-DD.
  assertEquals(scheduleToDates(longSummer, saved).summer, { start: "06-07", end: "08-20" });
});

Deno.test("subgroupSnapshot freezes only the members who are in a 동산", () => {
  assertEquals(
    subgroupSnapshot([
      { id: "1", subgroup: "건영동산" },
      { id: "2", subgroup: "" },
      { id: "3", subgroup: null },
      { id: "4", subgroup: " 중호동산 " },
    ]),
    { "1": "건영동산", "4": "중호동산" },
  );
});

Deno.test("trimHistory keeps the newest terms only", () => {
  const history: DongsanHistory = {};
  for (let i = 1; i <= 5; i++) {
    history[`term-${i}`] = { endedAt: `2026-0${i}-01`, subgroups: {}, names: {}, leaders: {} };
  }
  assertEquals(Object.keys(trimHistory(history, 5)).sort(), ["term-1", "term-2", "term-3", "term-4", "term-5"]);
  assertEquals(Object.keys(trimHistory(history, 2)).sort(), ["term-4", "term-5"]);
});
