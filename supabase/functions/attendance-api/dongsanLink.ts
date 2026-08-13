// 동산 리더용 출석 링크의 순수한 부분 — 저장된 값을 읽고, 토큰을 맞춰 보고, 화면에 놓을
// 주일을 세는 일. 표를 만지는 쪽은 index.ts에 있다.
//
// 링크 하나가 **한 자리**를 가리킨다(마이그레이션 20260817의 이유 참고). 자리는 둘 중 하나다:
//
//   · 동산 하나  — {group:'대학부'|'청년부'|'', subgroup:'호연선규'}  → 동산지기에게
//   · 부서 하나  — {group:'대학부'|'청년부',    subgroup:''}          → 부서 담당자에게
//
// 부서 링크는 그 부서의 동산을 다 담되 **여전히 동산모임 출석뿐**이다. 넓어진 것은 사람 수지
// 종류가 아니다 — 예배 출석도, 연락처도, 다른 부서도 이 문으로는 나가지 않는다.
//
// 둘 다 비어 있는 링크(group:'' + subgroup:'')는 만들지 않는다. 그것은 부 전체를 여는 열쇠라
// 범위를 짚지 못하고, 그런 열쇠를 없앤 것이 애초에 이 링크가 생긴 이유다. 서버가 만들 때
// 막고(index.ts), 여기서도 읽을 때 버린다 — 어느 쪽으로 들어와도 성립하지 않게.
//
// ── 학기가 링크의 수명이다 ───────────────────────────────────────────────────────────
// 부서 링크에는 그 링크가 사는 학기가 적혀 있다 (`term` = "2026-fall" — 아카이브와 동산
// 스냅숏이 이미 쓰는 그 키). 학기가 시작하면 그 학기의 링크가 저절로 나고, 학기가 끝나면
// 저절로 폐기된다. 사람이 매 학기 링크를 내고 거두는 일을 하지 않게 하는 것이 첫째 이유이고,
// 둘째 이유가 더 크다: **살아남은 지난 학기 링크는 "작년 담당자가 아직 우리 부서 명단을
// 연다"는 뜻**이라 남겨 둘 까닭이 없다. 그 판단을 사람의 기억에 맡기지 않는다.
//
// 그 규칙은 reconcileTermLinks() 하나가 통째로 쥐고 있다 — "지금 학기 × 시트가 담당하지 않는
// 부서" 만큼의 링크가 있어야 하고, 그 밖의 부서 링크는 없어야 한다. 순수 함수라 테스트가
// 붙고, 부르는 쪽(index.ts)은 매 요청에 불러도 바뀐 게 없으면 아무것도 쓰지 않는다.
//
// 학기에 매이지 않는 링크도 있다: `term`이 빈 링크 — 동산별로 내던 시절의 것과, 학기라는
// 것이 없는 부(장년부)에서 사람이 손으로 낸 것. 그 링크들은 이 규칙 바깥이라 자동으로
// 폐기되지 않고, 낸 사람이 손으로 거둔다.

export interface DongsanLink {
  token: string;
  /** 부서. 빈 문자열이면 부서를 가리지 않는다 (여름 합동처럼 같은 동산이 두 부서에 걸칠 때). */
  group: string;
  /** 동산. 빈 문자열이면 group 부서 **전체**를 가리키는 부서 링크다. */
  subgroup: string;
  /** 이 링크가 사는 학기 ("2026-fall"). 빈 문자열이면 학기에 매이지 않은 링크. */
  term: string;
  createdAt: number;
}

/** 이 링크가 부서 하나를 통째로 가리키는가 (동산 하나가 아니라). */
export function isGroupLink(link: DongsanLink): boolean {
  return !link.subgroup;
}

// deno-lint-ignore no-explicit-any
export function parseLinks(value: any): DongsanLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => x && typeof x.token === "string" && x.token)
    .map((x) => ({
      token: String(x.token),
      group: String(x.group || ""),
      subgroup: String(x.subgroup || ""),
      term: String(x.term || ""),
      createdAt: Number(x.createdAt) || 0,
    }))
    // 가리키는 자리가 없는 링크는 버린다 (위 주석의 그 이유).
    .filter((x) => x.group || x.subgroup);
}

// 주소에 사람이 읽을 수 있게 적히는 부서 이름. 한글을 그대로 실으면 브라우저에서 복사할 때
// %EB%8C%80… 로 바뀌어 카톡에 붙는 순간 아무것도 읽히지 않으므로, 주소에 그대로 실리는
// 글자로 옮겨 적는다.
const GROUP_SLUGS: Record<string, string> = {
  "대학부": "college",
  "청년부": "young",
  "장년부": "adult",
};

/**
 * 토큰 앞에 붙는, 사람이 읽는 부분 — "2026-fall-college".
 *
 * 링크를 두 장 이상 나눠 주는 사람이 **주소만 보고** 어느 학기 어느 부서 것인지 알 수 있어야
 * 한다 (그러라고 학기·연도·부서를 넣었다). 이름이 없는 부서면 학기만 적힌다.
 */
export function linkSlug(term: string, group: string): string {
  return [term, GROUP_SLUGS[group] || ""].filter(Boolean).join("-");
}

export function newLinkToken(term = "", group = ""): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  // 링크는 사람이 카톡으로 건네고 폰에서 여는 것이라 짧고 주소에 그대로 실리는 글자만 쓴다.
  // 앞에 붙는 이름표는 짐작할 수 있어도 열쇠가 아니다 — 여는 것은 뒤의 96비트다.
  const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const slug = linkSlug(term, group);
  return slug ? `${slug}-${secret}` : secret;
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

// ── 학기를 따라 나고 지는 부서 링크 ──────────────────────────────────────────────────

export interface TermLinkPlan {
  next: DongsanLink[];
  created: DongsanLink[];
  revoked: DongsanLink[];
}

/**
 * 저장된 링크 목록을 규칙 그대로 다시 세운다.
 *
 *   **부서 링크는 "지금 학기 × 링크가 담당하는 부서" 만큼 있고, 그 밖에는 없다.**
 *
 * · 학기가 바뀌면 지난 학기 링크는 `revoked`로 빠지고 새 학기 링크가 `created`로 난다.
 * · 학기 사이(term이 빈 값)에는 부서 링크가 하나도 남지 않는다 — 적을 학기가 없으니 열어 둘
 *   이유도 없다.
 * · `groups`에서 빠진 부서의 링크도 걷는다. 부르는 쪽이 거기에 넣지 않는 부서는 **시트가
 *   담당하는 부서**다 (같은 동산을 시트와 링크로 함께 적으면 다음 동기화가 링크로 적은 값을
 *   덮어쓴다 — 그래서 둘 중 하나만 연다).
 * · **동산 하나짜리 링크(subgroup이 있는 것)는 손대지 않는다.** 동산별로 내던 시절의 링크라
 *   이 규칙이 낸 것이 아니고, 낸 사람이 손으로 거둔다.
 *
 * 순수하다: 토큰을 만드는 일만 `mint`로 밖에 맡긴다(테스트가 정해진 토큰을 넣을 수 있게).
 * 바뀐 것이 없으면 created·revoked가 둘 다 비므로, 부르는 쪽은 그때 쓰기를 건너뛴다.
 */
export function reconcileTermLinks(
  links: DongsanLink[],
  opts: { term: string; groups: string[]; now: number; mint?: (term: string, group: string) => string },
): TermLinkPlan {
  const mint = opts.mint ?? newLinkToken;
  const kept: DongsanLink[] = [];
  const revoked: DongsanLink[] = [];
  for (const link of links) {
    if (link.subgroup) { kept.push(link); continue; } // 동산 링크 — 규칙 바깥
    const wanted = !!opts.term && link.term === opts.term && opts.groups.includes(link.group);
    (wanted ? kept : revoked).push(link);
  }
  const created: DongsanLink[] = [];
  if (opts.term) {
    for (const group of opts.groups) {
      if (kept.some((l) => !l.subgroup && l.group === group && l.term === opts.term)) continue;
      created.push({ token: mint(opts.term, group), group, subgroup: "", term: opts.term, createdAt: opts.now });
    }
  }
  return { next: [...kept, ...created], created, revoked };
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
