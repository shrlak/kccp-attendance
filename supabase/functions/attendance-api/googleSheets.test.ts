// Run with: deno test supabase/functions/attendance-api/googleSheets.test.ts
import { assertEquals, assertMatch } from "jsr:@std/assert";
import { explainSheetError, serviceAccountOf, signJwt, tabName, tabValues } from "./googleSheets.ts";

Deno.test("serviceAccountOf reads the key JSON and rejects anything else", () => {
  assertEquals(serviceAccountOf(JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "k" })),
    { email: "a@b.iam.gserviceaccount.com", privateKey: "k" });
  assertEquals(serviceAccountOf(""), null);
  assertEquals(serviceAccountOf("not json"), null);
  assertEquals(serviceAccountOf(JSON.stringify({ client_email: "x" })), null);
});

Deno.test("signJwt produces an RS256 token the public key verifies", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  const jwt = await signJwt({ email: "sa@x.iam.gserviceaccount.com", privateKey: pem }, "scope-a", 1000);
  const [h, c, s] = jwt.split(".");
  const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - x.length % 4) % 4)), (ch) => ch.charCodeAt(0));
  const claims = JSON.parse(new TextDecoder().decode(dec(c)));
  assertEquals(claims, { iss: "sa@x.iam.gserviceaccount.com", scope: "scope-a", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 });
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, dec(s), new TextEncoder().encode(`${h}.${c}`));
  assertEquals(ok, true);
});

Deno.test("tab values: header, rows, totals, footer note", () => {
  const block = { group: "대학부", rows: [{ name: "a", subgroup: "호연동산", cells: ["O", "X"], total: 1 }], totals: [1, 0] };
  const v = tabValues({ dates: ["2026-08-16", "2026-08-23"], blocks: [block], start: "2026-08-16", end: "2026-09-25", generatedAt: "2026-09-25T16:00:00Z" }, block);
  assertEquals(v[0], ["이름", "동산", "예배 총 출석", "08/16/2026", "08/23/2026"]);
  assertEquals(v[1], ["a", "호연동산", 1, "O", "X"]);
  assertEquals(v[2], ["총 출석", "", "", 1, 0]);
  assertMatch(String(v[4][0]), /^출석부에서 가져옴 · 2026-09-25 12:00 · 2026-08-16 ~ 2026-09-25/);
});

Deno.test("tab names carry the term only when the term was pinned", () => {
  const b = { group: "청년부", rows: [], totals: [] };
  assertEquals(tabName(b, "2026-fall", false), "출석부 · 청년부");
  assertEquals(tabName(b, "2026-summer", true), "출석부 · 청년부 (2026-summer)");
});

Deno.test("a 403 says how to fix sharing, naming the service account", () => {
  const e = Object.assign(new Error("denied"), { status: 403 });
  assertMatch(explainSheetError(e, "sa@x.iam.gserviceaccount.com"), /편집자.*sa@x\.iam\.gserviceaccount\.com/);
  assertEquals(explainSheetError(new Error("boom"), "x"), "boom");
});
