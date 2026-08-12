// 동산 리더용 출석 링크의 순수한 부분 — 저장된 값을 읽고, 토큰을 맞춰 보고, 화면에 놓을
// 주일을 세는 일. 표를 만지는 쪽은 index.ts에 있다.
//
// 링크 하나가 동산 하나를 가리킨다(마이그레이션 20260817의 이유 참고). 그래서 토큰을 푼
// 결과는 언제나 "어느 부 · 어느 부서 · 어느 동산"이고, 그 밖의 것은 이 문으로 나가지 않는다.

export interface DongsanLink {
  token: string;
  /** 빈 문자열이면 부서를 가리지 않는다 (여름 합동처럼 같은 동산이 두 부서에 걸칠 때). */
  group: string;
  subgroup: string;
  createdAt: number;
}

// deno-lint-ignore no-explicit-any
export function parseLinks(value: any): DongsanLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => x && typeof x.token === "string" && x.token && typeof x.subgroup === "string" && x.subgroup)
    .map((x) => ({
      token: String(x.token),
      group: String(x.group || ""),
      subgroup: String(x.subgroup),
      createdAt: Number(x.createdAt) || 0,
    }));
}

export function newLinkToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  // 링크는 사람이 카톡으로 건네고 폰에서 여는 것이라 짧고 주소에 그대로 실리는 글자만 쓴다.
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 같은 길이의 두 토큰을 끝까지 다 비교한다 — 앞 글자부터 맞춰 보며 걸리는 시간으로 토큰을
// 알아내는 수를 막는다 (sheet_sync 토큰과 같은 이유, 같은 방식).
function tokenEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function findLink(links: DongsanLink[], token: string): DongsanLink | null {
  if (!token) return null;
  for (const link of links) if (tokenEq(link.token, token)) return link;
  return null;
}

/** 같은 동산을 두 번 발급하지 않는다 — 이미 있으면 그 링크가 그 동산의 링크다. */
export function findLinkFor(links: DongsanLink[], group: string, subgroup: string): DongsanLink | null {
  return links.find((l) => l.group === group && l.subgroup === subgroup) ?? null;
}

export function addIsoDays(day: string, amount: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + amount);
  return at.toISOString().slice(0, 10);
}

/**
 * 화면에 놓을 주일들 — 오늘(또는 오늘이 주일이면 오늘)부터 거슬러 count개, 오래된 것이 앞.
 *
 * 날짜를 아무 날이나 고르게 하지 않는 이유: 동산모임 출석은 시트에서도 주일 칸에 적혀 왔고
 * (parseSheetDate가 읽는 그 열들이 전부 주일이다), 링크로 들어온 출석이 다른 요일에 흩어지면
 * 같은 한 주가 출석부에서 두 칸으로 갈린다. 적을 수 있는 날을 주일로 묶어 두면 시트에서 온
 * 줄과 링크에서 온 줄이 같은 칸에 앉는다.
 */
export function recentSundays(today: string, count: number): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = 주일
  const lastSunday = addIsoDays(today, -dow);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addIsoDays(lastSunday, -7 * i));
  return out;
}
