import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PAGE_ROWS, selectAll } from "./page.ts";

// 한 표를 흉내 낸다: range(from,to)를 받아 그 조각을 돌려주되, **서버의 max-rows에서 자른다**
// — 이것이 PostgREST가 하는 일이고, 잘렸다는 사실은 응답 어디에도 적히지 않는다.
function table(rows: number[], maxRows: number) {
  const calls: [number, number][] = [];
  const build = () => ({
    range(from: number, to: number) {
      calls.push([from, to]);
      const capped = Math.min(to - from + 1, maxRows);
      return Promise.resolve({ data: rows.slice(from, from + capped), error: null });
    },
  });
  return { build, calls };
}

Deno.test("1000줄의 벽을 넘는 표를 끝까지 읽는다", async () => {
  const rows = Array.from({ length: 1836 }, (_, i) => i);
  const { build, calls } = table(rows, PAGE_ROWS);
  assertEquals(await selectAll<number>(build), rows);
  // 두 번에 나눠 물었고, 두 번째 요청이 첫 페이지 **바로 다음** 줄에서 이어졌다.
  assertEquals(calls, [[0, 999], [1000, 1999]]);
});

Deno.test("벽에 닿지 않는 표는 한 번만 묻는다 — 제일 자주 도는 길에 얹어도 왕복이 늘지 않는다", async () => {
  const rows = Array.from({ length: 435 }, (_, i) => i);
  const { build, calls } = table(rows, PAGE_ROWS);
  assertEquals(await selectAll<number>(build), rows);
  assertEquals(calls.length, 1);
});

Deno.test("줄 수가 벽의 배수라도 한 줄도 더 만들지 않는다", async () => {
  const rows = Array.from({ length: PAGE_ROWS }, (_, i) => i);
  const { build, calls } = table(rows, PAGE_ROWS);
  assertEquals(await selectAll<number>(build), rows);
  // 가득 찬 페이지는 마지막인지 알 수 없으므로 한 번 더 묻고, 빈 페이지에서 멈춘다.
  assertEquals(calls.length, 2);
});

Deno.test("빈 표", async () => {
  const { build } = table([], PAGE_ROWS);
  assertEquals(await selectAll<number>(build), []);
});

Deno.test("오류는 삼키지 않고 던진다 — 빈 배열로 돌려주면 '조용히 없는 줄'이 그대로 돌아온다", async () => {
  const build = () => ({
    range: () => Promise.resolve({ data: null, error: new Error("boom") }),
  });
  await assertRejects(() => selectAll(build), Error, "boom");
});
