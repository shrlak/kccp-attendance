// Run with: deno test supabase/functions/attendance-api/auth.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import { isPersonalDevice, scopeFilter, type Role } from "./auth.ts";

const leader: Role = {
  memberId: "m", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM",
};

Deno.test("isPersonalDevice: ROSTER stubs are not personal", () => {
  assertEquals(isPersonalDevice("ROSTER-44"), false);
  assertEquals(isPersonalDevice("DEV-B5D13150-CCFD0D1F"), true);
  assertEquals(isPersonalDevice("NEW-1780798747776"), true);
  assertEquals(isPersonalDevice(""), false);
});

Deno.test("super_admin sees everything (no filter)", () => {
  const s: Role = { memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
});

Deno.test("pastor sees everything (read-only is enforced elsewhere)", () => {
  const s: Role = { memberId: "m", role: "pastor", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
});

Deno.test("leader is scoped to their group+subgroup in semester mode", () => {
  assertEquals(scopeFilter(leader, false), { all: false, groups: ["청년부"], subgroup: "건영동산" });
});

Deno.test("KM leader spans both depts in summer mode (합동)", () => {
  assertEquals(scopeFilter(leader, true), { all: false, groups: ["대학부", "청년부"], subgroup: "건영동산" });
});

Deno.test("welcoming is scoped to its group", () => {
  const s: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM" };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["청년부"], subgroup: "" });
});
