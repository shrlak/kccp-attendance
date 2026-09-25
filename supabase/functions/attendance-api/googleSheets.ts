// 출석부 → 구글 시트, **링크만 붙여넣으면** 되는 길.
//
// 구글은 로그인하지 않은 쪽의 시트 쓰기를 받지 않는다 — 링크 공개가 '편집자'여도 그렇다.
// 그래서 서버가 자기 구글 계정(서비스 계정)을 하나 갖는다: 환경변수
// `GOOGLE_SERVICE_ACCOUNT_JSON`(Google Cloud에서 내려받은 키 JSON 통째). 링크 공유가
// '링크가 있는 모든 사용자 · 편집자'인 시트는 로그인한 누구나 고칠 수 있으므로 이 계정도
// 고칠 수 있다 — 그래서 사람이 할 일은 링크를 붙여넣는 것 하나다. 링크를 공개하고 싶지 않은
// 시트는 그 계정의 이메일(`client_email`)을 편집자로 추가하면 같은 결과가 된다.
//
// 이 파일은 구글과 이야기하는 부분 전부다: 서명한 JWT로 토큰을 받고, 부서마다 탭 하나를
// 통째로 다시 쓴다. 표의 내용은 sheetExport.ts가 정한다 (Export.gs가 받아 적던 그 표).

import type { ExportBlock, ExportGrid } from "./sheetExport.ts";

export interface ServiceAccount { email: string; privateKey: string }

/** 환경변수의 키 JSON을 읽는다. 없거나 모양이 틀리면 null — 그 길은 꺼진 것이다. */
export function serviceAccountOf(raw: string | undefined | null): ServiceAccount | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (typeof j?.client_email !== "string" || typeof j?.private_key !== "string") return null;
    return { email: j.client_email, privateKey: j.private_key };
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** 구글 OAuth에 내밀 서명된 JWT (RS256). */
export async function signJwt(sa: ServiceAccount, scope: string, nowSec: number): Promise<string> {
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({
    iss: sa.email, scope, aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600,
  }));
  const key = await importKey(sa.privateKey);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}

// 토큰은 한 시간 산다. 아이솔레이트가 살아 있는 동안은 다시 받지 않는다.
let cached: { email: string; token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === sa.email && cached.exp - 60 > now) return cached.token;
  const assertion = await signJwt(sa, "https://www.googleapis.com/auth/spreadsheets", now);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`구글 로그인 실패 (${res.status}): ${j.error_description || j.error || "알 수 없음"}`);
  cached = { email: sa.email, token: j.access_token, exp: now + Number(j.expires_in || 3600) };
  return j.access_token;
}

export const TAB_PREFIX = "출석부 · ";

export function tabName(block: ExportBlock, term: string, pinnedTerm: boolean): string {
  return TAB_PREFIX + (block.group || "부서 미기재") + (pinnedTerm && term ? ` (${term})` : "");
}

/** "2026-08-16" → "08/16/2026" (교회 시트의 날짜 모양). */
function sheetDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** 탭 하나에 들어갈 값 — Export.gs가 적던 것과 같은 모양이다. */
export function tabValues(grid: ExportGrid & { start: string; end: string; generatedAt: string }, block: ExportBlock): (string | number)[][] {
  const rows: (string | number)[][] = [["이름", "동산", "예배 총 출석", ...grid.dates.map(sheetDate)]];
  for (const r of block.rows) rows.push([r.name, r.subgroup, r.total, ...r.cells]);
  rows.push(["총 출석", "", "", ...block.totals]);
  rows.push([]);
  const when = new Date(grid.generatedAt).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16);
  rows.push([`출석부에서 가져옴 · ${when} · ${grid.start} ~ ${grid.end} · 이 탭은 갱신될 때마다 통째로 다시 쓰입니다`]);
  return rows;
}

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

async function gapi(token: string, method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j?.error?.message || `HTTP ${res.status}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return j;
}

/** 사람이 읽을 실패 이유. 권한 문제가 제일 흔하므로 고치는 법까지 적는다. */
export function explainSheetError(e: unknown, saEmail: string): string {
  const status = (e as { status?: number })?.status;
  if (status === 403) {
    return `이 시트에 쓸 권한이 없습니다 — 공유에서 '링크가 있는 모든 사용자'를 '편집자'로 바꾸거나 ${saEmail} 을(를) 편집자로 추가해 주세요.`;
  }
  if (status === 404) return "시트를 찾을 수 없습니다 — 링크가 맞는지, 시트가 지워지지 않았는지 확인해 주세요.";
  return e instanceof Error ? e.message : String(e);
}

/**
 * 스프레드시트 하나에 부서마다 탭을 쓴다. 이 함수가 만든 탭(`출석부 · …`) 밖은 건드리지 않는다.
 * 새로 만든 탭에만 모양(머리줄 고정·굵게·O/X 색)을 한 번 입힌다 — 매번 입히면 규칙이 쌓인다.
 */
export async function writeGridToSpreadsheet(
  sa: ServiceAccount,
  spreadsheetId: string,
  grid: ExportGrid & { start: string; end: string; generatedAt: string; term: string },
  pinnedTerm = false,
): Promise<string[]> {
  const token = await accessToken(sa);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const meta = await gapi(token, "GET", `${base}?fields=sheets.properties(sheetId,title)`);
  const existing = new Map<string, number>();
  // deno-lint-ignore no-explicit-any
  for (const s of meta.sheets || []) existing.set(s.properties.title, s.properties.sheetId);

  const tabs = grid.blocks.map((b) => ({ block: b, title: tabName(b, grid.term, pinnedTerm) }));
  const missing = tabs.filter((t) => !existing.has(t.title));
  if (missing.length) {
    const added = await gapi(token, "POST", `${base}:batchUpdate`, {
      requests: missing.map((t) => ({ addSheet: { properties: { title: t.title } } })),
    });
    // deno-lint-ignore no-explicit-any
    for (const r of added.replies || []) existing.set(r.addSheet.properties.title, r.addSheet.properties.sheetId);
  }
  if (!tabs.length) return [];

  await gapi(token, "POST", `${base}/values:batchClear`, { ranges: tabs.map((t) => quote(t.title)) });
  await gapi(token, "POST", `${base}/values:batchUpdate`, {
    valueInputOption: "RAW",
    data: tabs.map((t) => ({ range: `${quote(t.title)}!A1`, values: tabValues(grid, t.block) })),
  });

  if (missing.length) {
    const requests = missing.flatMap((t) => {
      const sheetId = existing.get(t.title)!;
      const body = { sheetId, startRowIndex: 1, startColumnIndex: 3 };
      const color = (rgb: [number, number, number]) => ({ red: rgb[0], green: rgb[1], blue: rgb[2] });
      return [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } }, fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: color([0.435, 0.659, 0.863]) } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } },
        { addConditionalFormatRule: { index: 0, rule: { ranges: [body], booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "O" }] }, format: { textFormat: { foregroundColor: color([0.086, 0.639, 0.29]) } } } } } },
        { addConditionalFormatRule: { index: 1, rule: { ranges: [body], booleanRule: { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "X" }] }, format: { textFormat: { foregroundColor: color([0.69, 0.69, 0.69]) } } } } } },
      ];
    });
    await gapi(token, "POST", `${base}:batchUpdate`, { requests });
  }
  return tabs.map((t) => t.title);
}
