// Run with: deno test supabase/functions/attendance-api/auth.test.ts
// (Deno isn't part of the local web toolchain; these run on a Supabase branch / CI
//  where the Deno runtime is available — plan Task C1.)
import { assertEquals } from "jsr:@std/assert";
import { scopeFilter, type Staff } from "./auth.ts";

const leader: Staff = {
  userId: "u", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM",
};

Deno.test("super_admin sees everything (no filter)", () => {
  const s: Staff = { userId: "u", role: "super_admin", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
});

Deno.test("pastor sees everything (read-only is enforced elsewhere)", () => {
  const s: Staff = { userId: "u", role: "pastor", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
});

Deno.test("leader is scoped to their group+subgroup in semester mode", () => {
  assertEquals(scopeFilter(leader, false), { all: false, groups: ["청년부"], subgroup: "건영동산" });
});

Deno.test("KM leader spans both depts in summer mode (합동)", () => {
  assertEquals(scopeFilter(leader, true), { all: false, groups: ["대학부", "청년부"], subgroup: "건영동산" });
});

Deno.test("welcoming is scoped to its group", () => {
  const s: Staff = { userId: "u", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM" };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["청년부"], subgroup: "" });
});
