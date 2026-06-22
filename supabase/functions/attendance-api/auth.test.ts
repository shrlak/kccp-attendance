// Run with: deno test supabase/functions/attendance-api/auth.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import { isPersonalDevice, scopeFilter, verifyAdmin, MASTER_PASSWORD, type Role } from "./auth.ts";

const leader: Role = {
  memberId: "m", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM",
};

// Minimal chainable Supabase stub: every .from(table)…single() resolves to data[table].
// deno-lint-ignore no-explicit-any
function mockSb(data: Record<string, any>): any {
  return {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        single: () => Promise.resolve({ data: data[table] ?? null }),
      };
      return chain;
    },
  };
}

Deno.test("isPersonalDevice: ROSTER stubs are not personal", () => {
  assertEquals(isPersonalDevice("ROSTER-44"), false);
  assertEquals(isPersonalDevice("DEV-B5D13150-CCFD0D1F"), true);
  assertEquals(isPersonalDevice("NEW-1780798747776"), true);
  assertEquals(isPersonalDevice(""), false);
});

Deno.test("verifyAdmin: wrong password is rejected (no DB hit)", async () => {
  const r = await verifyAdmin(mockSb({}), "DEV-anything", "nope");
  assertEquals(r, null);
});

Deno.test("verifyAdmin: master password grants break-glass 'staff' from an unregistered device", async () => {
  // A brand-new personal device with no row in `devices` → break-glass staff (리더+새가족팀).
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", MASTER_PASSWORD);
  assertEquals(r, { memberId: "", role: "staff", group: "", subgroup: "", ministry: "" });
});

Deno.test("verifyAdmin: master password works on a ROSTER/blank device too (staff)", async () => {
  const r = await verifyAdmin(mockSb({}), "ROSTER-12", MASTER_PASSWORD);
  assertEquals(r?.role, "staff");
  const blank = await verifyAdmin(mockSb({}), "", MASTER_PASSWORD);
  assertEquals(blank?.role, "staff");
});

Deno.test("verifyAdmin: a registered device linked to a leader keeps that scope", async () => {
  const r = await verifyAdmin(
    mockSb({
      devices: { member_id: "m1" },
      member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" },
    }),
    "DEV-KNOWN-01",
    MASTER_PASSWORD,
  );
  assertEquals(r, { memberId: "m1", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM" });
});

Deno.test("super_admin sees everything (no filter)", () => {
  const s: Role = { memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
});

Deno.test("pastor sees everything (read-only is enforced elsewhere)", () => {
  const s: Role = { memberId: "m", role: "pastor", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
});

Deno.test("staff (break-glass) sees the whole roster, like super/pastor", () => {
  const s: Role = { memberId: "", role: "staff", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
  assertEquals(scopeFilter(s, true), { all: true });
});

Deno.test("leader is scoped to their group+subgroup in semester mode", () => {
  assertEquals(scopeFilter(leader, false), { all: false, groups: ["청년부"], subgroup: "건영동산" });
});

Deno.test("KM leader spans both depts in summer mode (합동)", () => {
  assertEquals(scopeFilter(leader, true), { all: false, groups: ["대학부", "청년부"], subgroup: "건영동산" });
});

Deno.test("합동 leader spans both 부서 in EVERY season (임원 account)", () => {
  const s: Role = { memberId: "m", role: "leader", group: "합동", subgroup: "", ministry: "KM" };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
  assertEquals(scopeFilter(s, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
});

Deno.test("welcoming is scoped to its group in semester mode (봄/가을동산)", () => {
  const s: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM" };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["청년부"], subgroup: "" });
});

Deno.test("welcoming spans both 부서 in summer mode (여름동산 합동)", () => {
  const univ: Role = { memberId: "m", role: "welcoming", group: "대학부", subgroup: "", ministry: "KM" };
  const young: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM" };
  assertEquals(scopeFilter(univ, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
  assertEquals(scopeFilter(young, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
});
