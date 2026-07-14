// Ported from supabase/functions/attendance-api/auth.test.ts (Deno). The original mocked
// the supabase-js client; here `verifyAdmin` talks to a real (Miniflare-local) D1 instance
// migrated by test/apply-migrations.ts, so the "registered device" cases insert real rows
// instead of stubbing a client.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isPersonalDevice, passwordRole, scopeFilter, verifyAdmin, type Role } from "../src/lib/auth";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;
const SUPER_PASSWORD = "kccpadmin";
const LEADER_PASSWORD = "kccpleaders";
const WELCOMING_PASSWORD = "kccpwelcome";

const leader: Role = { memberId: "m", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM" };

describe("isPersonalDevice", () => {
  it("ROSTER stubs are not personal", () => {
    expect(isPersonalDevice("ROSTER-44")).toBe(false);
    expect(isPersonalDevice("DEV-B5D13150-CCFD0D1F")).toBe(true);
    expect(isPersonalDevice("NEW-1780798747776")).toBe(true);
    expect(isPersonalDevice("")).toBe(false);
  });
});

describe("passwordRole", () => {
  it("maps each password to its break-glass role", () => {
    expect(passwordRole(SUPER_PASSWORD, testEnv)).toBe("super_admin");
    expect(passwordRole(LEADER_PASSWORD, testEnv)).toBe("leader");
    expect(passwordRole(WELCOMING_PASSWORD, testEnv)).toBe("welcoming");
    expect(passwordRole("nope", testEnv)).toBeNull();
    expect(passwordRole("", testEnv)).toBeNull();
  });
});

describe("verifyAdmin", () => {
  it("rejects a wrong password (no DB hit)", async () => {
    const r = await verifyAdmin(testEnv.DB, "DEV-anything", "nope", testEnv);
    expect(r).toBeNull();
  });

  it("super password grants break-glass 'super_admin' from an unregistered device", async () => {
    const r = await verifyAdmin(testEnv.DB, "DEV-UNKNOWN-99", SUPER_PASSWORD, testEnv);
    expect(r).toEqual({ memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "" });
  });

  it("leader password grants break-glass 'leader' from an unregistered device", async () => {
    const r = await verifyAdmin(testEnv.DB, "DEV-UNKNOWN-98", LEADER_PASSWORD, testEnv);
    expect(r).toEqual({ memberId: "", role: "leader", group: "", subgroup: "", ministry: "" });
  });

  it("welcoming password grants break-glass 'welcoming' from an unregistered device", async () => {
    const r = await verifyAdmin(testEnv.DB, "DEV-UNKNOWN-97", WELCOMING_PASSWORD, testEnv);
    expect(r).toEqual({ memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "" });
  });

  it("either password works on a ROSTER/blank device too", async () => {
    expect((await verifyAdmin(testEnv.DB, "ROSTER-12", LEADER_PASSWORD, testEnv))?.role).toBe("leader");
    expect((await verifyAdmin(testEnv.DB, "", WELCOMING_PASSWORD, testEnv))?.role).toBe("welcoming");
  });

  it("a registered device linked to a leader keeps that scope", async () => {
    const db = testEnv.DB;
    await db.prepare("INSERT INTO members (id, name) VALUES (?, ?)").bind("m1", "Test Leader").run();
    await db
      .prepare("INSERT INTO member_roles (member_id, role, group_name, subgroup, ministry) VALUES (?, 'leader', ?, ?, ?)")
      .bind("m1", "청년부", "건영동산", "KM")
      .run();
    await db.prepare("INSERT INTO devices (id, name, member_id) VALUES (?, ?, ?)").bind("DEV-KNOWN-01", "Test Leader", "m1").run();

    const r = await verifyAdmin(db, "DEV-KNOWN-01", WELCOMING_PASSWORD, testEnv);
    expect(r).toEqual({ memberId: "m1", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM" });
  });
});

describe("scopeFilter", () => {
  it("super_admin sees everything (no filter)", () => {
    const s: Role = { memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "" };
    expect(scopeFilter(s, false)).toEqual({ all: true });
  });

  it("pastor sees everything (read-only is enforced elsewhere)", () => {
    const s: Role = { memberId: "m", role: "pastor", group: "", subgroup: "", ministry: "" };
    expect(scopeFilter(s, false)).toEqual({ all: true });
  });

  it("staff (break-glass) sees the whole roster, like super/pastor", () => {
    const s: Role = { memberId: "", role: "staff", group: "", subgroup: "", ministry: "" };
    expect(scopeFilter(s, false)).toEqual({ all: true });
    expect(scopeFilter(s, true)).toEqual({ all: true });
  });

  it("break-glass leader/welcoming (no memberId) see the whole roster", () => {
    const bgLeader: Role = { memberId: "", role: "leader", group: "", subgroup: "", ministry: "" };
    const bgWelcoming: Role = { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "" };
    expect(scopeFilter(bgLeader, false)).toEqual({ all: true });
    expect(scopeFilter(bgLeader, true)).toEqual({ all: true });
    expect(scopeFilter(bgWelcoming, false)).toEqual({ all: true });
    expect(scopeFilter(bgWelcoming, true)).toEqual({ all: true });
  });

  it("leader is scoped to their group+subgroup in semester mode", () => {
    expect(scopeFilter(leader, false)).toEqual({ all: false, groups: ["청년부"], subgroup: "건영동산" });
  });

  it("KM leader spans both depts in summer mode (합동)", () => {
    expect(scopeFilter(leader, true)).toEqual({ all: false, groups: ["대학부", "청년부"], subgroup: "건영동산" });
  });

  it("합동 leader spans both 부서 in EVERY season (임원 account)", () => {
    const s: Role = { memberId: "m", role: "leader", group: "합동", subgroup: "", ministry: "KM" };
    expect(scopeFilter(s, false)).toEqual({ all: false, groups: ["대학부", "청년부"], subgroup: "" });
    expect(scopeFilter(s, true)).toEqual({ all: false, groups: ["대학부", "청년부"], subgroup: "" });
  });

  it("welcoming is scoped to its group in semester mode (봄/가을동산)", () => {
    const s: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM" };
    expect(scopeFilter(s, false)).toEqual({ all: false, groups: ["청년부"], subgroup: "" });
  });

  it("welcoming spans both 부서 in summer mode (여름동산 합동)", () => {
    const univ: Role = { memberId: "m", role: "welcoming", group: "대학부", subgroup: "", ministry: "KM" };
    const young: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM" };
    expect(scopeFilter(univ, true)).toEqual({ all: false, groups: ["대학부", "청년부"], subgroup: "" });
    expect(scopeFilter(young, true)).toEqual({ all: false, groups: ["대학부", "청년부"], subgroup: "" });
  });
});
