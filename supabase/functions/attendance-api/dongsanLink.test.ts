import { assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { addIsoDays, findLink, findLinkFor, isGroupLink, linkSlug, newLinkToken, parseLinks, reconcileTermLinks, recentSundays, type DongsanLink } from "./dongsanLink.ts";

Deno.test("저장된 링크를 읽는다 — 모양이 어긋난 줄은 버린다", () => {
  const links = parseLinks([
    { token: "aaa", group: "대학부", subgroup: "호연선규", createdAt: 1723000000000 },
    { token: "bbb", subgroup: "건영동산" }, // group 없음 = 합동 동산, createdAt 없음
    { token: "ccc", group: "청년부", term: "2026-fall" }, // subgroup 없음 = 부서 전체를 담는 링크
    { token: "", subgroup: "빈 토큰" }, // 버린다
    { token: "ddd" }, // 동산도 부서도 없다 = 부 전체를 여는 열쇠 — 버린다
    { token: "eee", group: "", subgroup: "" }, // 같은 이유로 버린다
    null,
    "문자열",
  ]);
  assertEquals(links, [
    { token: "aaa", group: "대학부", subgroup: "호연선규", term: "", createdAt: 1723000000000 },
    { token: "bbb", group: "", subgroup: "건영동산", term: "", createdAt: 0 },
    { token: "ccc", group: "청년부", subgroup: "", term: "2026-fall", createdAt: 0 },
  ]);
  assertEquals(parseLinks(undefined), []);
  assertEquals(parseLinks({ token: "aaa" }), []);
});

Deno.test("부서 링크와 동산 링크를 가른다", () => {
  const [dongsan, group] = parseLinks([
    { token: "aaa", group: "대학부", subgroup: "호연선규" },
    { token: "bbb", group: "대학부" },
  ]);
  assertEquals(isGroupLink(dongsan), false);
  assertEquals(isGroupLink(group), true);
  // 부서 링크는 그 부서의 자리 하나다 — 같은 부서를 두 번 내지 않는다.
  const links = [dongsan, group];
  assertEquals(findLinkFor(links, "대학부", "")?.token, "bbb");
  assertEquals(findLinkFor(links, "청년부", ""), null);
});

Deno.test("토큰으로 링크를 찾는다", () => {
  const links = parseLinks([
    { token: "aaa", group: "", subgroup: "건영동산" },
    { token: "bbb", group: "청년부", subgroup: "호연선규" },
  ]);
  assertEquals(findLink(links, "bbb")?.subgroup, "호연선규");
  assertEquals(findLink(links, "zzz"), null);
  assertEquals(findLink(links, ""), null);
  // 길이가 다른 토큰도 조용히 빗나가야 한다 (앞부분만 맞는 것으로는 열리지 않는다).
  assertEquals(findLink(links, "aa"), null);
  assertEquals(findLink(links, "aaaa"), null);
});

Deno.test("같은 동산에는 링크가 하나뿐이다", () => {
  const links = parseLinks([
    { token: "aaa", group: "대학부", subgroup: "호연선규" },
    { token: "bbb", group: "청년부", subgroup: "호연선규" },
  ]);
  // 부서가 다르면 다른 동산이다 — 봄·가을에는 같은 이름이 두 부서에 따로 설 수 있다.
  assertEquals(findLinkFor(links, "대학부", "호연선규")?.token, "aaa");
  assertEquals(findLinkFor(links, "청년부", "호연선규")?.token, "bbb");
  assertEquals(findLinkFor(links, "", "호연선규"), null);
  assertEquals(findLinkFor(links, "대학부", "없는동산"), null);
});

Deno.test("토큰은 매번 다르다", () => {
  const a = newLinkToken(), b = newLinkToken();
  assertNotEquals(a, b);
  assertEquals(a.length, 24);
  assertEquals(/^[0-9a-f]+$/.test(a), true);
});

Deno.test("주소에 학기와 연도와 부서가 적힌다", () => {
  assertEquals(linkSlug("2026-fall", "대학부"), "2026-fall-college");
  assertEquals(linkSlug("2026-fall", "청년부"), "2026-fall-young");
  assertEquals(linkSlug("2026-fall", ""), "2026-fall"); // 부서 없는 링크는 학기만
  const token = newLinkToken("2026-fall", "청년부");
  assertStringIncludes(token, "2026-fall-young-");
  // 이름표 뒤에 붙는 무작위 부분이 여전히 열쇠다 (12바이트 = 24자).
  assertEquals(token.slice("2026-fall-young-".length).length, 24);
  assertNotEquals(newLinkToken("2026-fall", "청년부"), token);
});

// ── 학기를 따라 나고 지는 부서 링크 ──────────────────────────────────────────────────

function links(...rows: Partial<DongsanLink>[]): DongsanLink[] {
  return parseLinks(rows);
}
// 토큰이 정해져 있어야 결과를 눈으로 확인할 수 있다.
const mint = (term: string, group: string) => `${linkSlug(term, group)}-tok`;

Deno.test("학기가 시작하면 부서마다 링크가 저절로 난다", () => {
  const plan = reconcileTermLinks([], { term: "2026-fall", groups: ["대학부", "청년부"], now: 7, mint });
  assertEquals(plan.created.map((l) => l.token), ["2026-fall-college-tok", "2026-fall-young-tok"]);
  assertEquals(plan.next.map((l) => l.term), ["2026-fall", "2026-fall"]);
  assertEquals(plan.revoked, []);
  // 이미 그 학기의 링크가 있으면 아무것도 하지 않는다 — 매 요청에 불러도 주소가 바뀌지 않는다.
  const again = reconcileTermLinks(plan.next, { term: "2026-fall", groups: ["대학부", "청년부"], now: 8, mint });
  assertEquals(again.created, []);
  assertEquals(again.revoked, []);
  assertEquals(again.next, plan.next);
});

Deno.test("학기가 끝나면 지난 학기 링크는 폐기되고 새 학기 링크가 난다", () => {
  const stored = links(
    { token: "2026-summer-college-tok", group: "대학부", term: "2026-summer" },
    { token: "2026-summer-young-tok", group: "청년부", term: "2026-summer" },
  );
  const plan = reconcileTermLinks(stored, { term: "2026-fall", groups: ["대학부", "청년부"], now: 7, mint });
  assertEquals(plan.revoked.map((l) => l.token), ["2026-summer-college-tok", "2026-summer-young-tok"]);
  assertEquals(plan.next.map((l) => l.token), ["2026-fall-college-tok", "2026-fall-young-tok"]);
});

Deno.test("학기 사이에는 부서 링크가 하나도 남지 않는다", () => {
  const stored = links({ token: "2026-fall-college-tok", group: "대학부", term: "2026-fall" });
  const plan = reconcileTermLinks(stored, { term: "", groups: [], now: 7, mint });
  assertEquals(plan.next, []);
  assertEquals(plan.revoked.length, 1);
});

Deno.test("시트가 담당하는 부서에는 링크를 내지 않는다", () => {
  // groups에서 빠진 부서 = 그 부서의 동산 출석은 구글 시트가 갖고 온다.
  const stored = links({ token: "2026-fall-college-tok", group: "대학부", term: "2026-fall" });
  const plan = reconcileTermLinks(stored, { term: "2026-fall", groups: ["청년부"], now: 7, mint });
  assertEquals(plan.created.map((l) => l.group), ["청년부"]);
  assertEquals(plan.revoked.map((l) => l.group), ["대학부"]);
});

Deno.test("동산 하나짜리 옛 링크는 규칙 바깥이라 그대로 남는다", () => {
  const stored = links(
    { token: "old", group: "", subgroup: "건영동산" },
    { token: "stale-group", group: "대학부" }, // 학기가 적히기 전의 부서 링크 — 새 것으로 갈린다
  );
  const plan = reconcileTermLinks(stored, { term: "2026-fall", groups: ["대학부"], now: 7, mint });
  assertEquals(plan.next.map((l) => l.token), ["old", "2026-fall-college-tok"]);
  assertEquals(plan.revoked.map((l) => l.token), ["stale-group"]);
});

Deno.test("주일만 고를 수 있다 — 오늘부터 거슬러 8주", () => {
  // 2026-08-12는 수요일 → 가장 가까운 지난 주일은 8월 9일.
  const weeks = recentSundays("2026-08-12", 8);
  assertEquals(weeks.length, 8);
  assertEquals(weeks[weeks.length - 1], "2026-08-09");
  assertEquals(weeks[0], "2026-06-21");
  // 오래된 것이 앞 — 화면은 뒤집어 보여주고 서버는 범위 질의에 양 끝을 쓴다.
  assertEquals([...weeks].sort(), weeks);
});

Deno.test("오늘이 주일이면 오늘이 그 주다", () => {
  const weeks = recentSundays("2026-08-09", 3);
  assertEquals(weeks, ["2026-07-26", "2026-08-02", "2026-08-09"]);
});

Deno.test("달과 해를 넘어간다", () => {
  assertEquals(recentSundays("2026-01-03", 2), ["2025-12-21", "2025-12-28"]);
  assertEquals(addIsoDays("2026-02-28", 1), "2026-03-01");
  assertEquals(addIsoDays("2028-02-28", 1), "2028-02-29"); // 윤년
  assertEquals(addIsoDays("2026-01-01", -1), "2025-12-31");
});
