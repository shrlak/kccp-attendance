// Run with: deno test supabase/functions/attendance-api/auth.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import {
  ADULT_GROUP,
  ADULT_PASSWORD,
  isPersonalDevice,
  inScope,
  inScopeGroup,
  partitionOfGroup,
  partitionOfRole,
  scopeFilter,
  verifyAdmin,
  passwordGrant,
  passwordRole,
  canViewLoginLog,
  LOGIN_LOG_VIEWER_MEMBER_ID,
  SUPER_PASSWORD,
  LEADER_PASSWORD,
  WELCOMING_PASSWORD,
  MASTER_PASSWORD,
  type Role,
  type Scope,
} from "./auth.ts";

const leader: Role = {
  memberId: "m", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM", partition: "youth",
};
// 대학·청년부 "everything" is everything except the other partition.
const YOUTH_ALL: Scope = { all: true, exclude: [ADULT_GROUP] };

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

Deno.test("partitionOfGroup: only 장년부 is the adult partition", () => {
  assertEquals(partitionOfGroup(ADULT_GROUP), "adult");
  assertEquals(partitionOfGroup("대학부"), "youth");
  assertEquals(partitionOfGroup("청년부"), "youth");
  assertEquals(partitionOfGroup("EM"), "youth");
  // guests / legacy rows with no 부서 stay where they have always shown up
  assertEquals(partitionOfGroup(""), "youth");
  assertEquals(partitionOfGroup(null), "youth");
});

Deno.test("partitionOfRole: a grant is 장년부's via its 부서 or its 사역", () => {
  assertEquals(partitionOfRole(ADULT_GROUP, ""), "adult");
  assertEquals(partitionOfRole("", ADULT_GROUP), "adult");
  assertEquals(partitionOfRole("청년부", "KM"), "youth");
  assertEquals(partitionOfRole("", ""), "youth");
});

Deno.test("passwordRole: maps each password to its break-glass role", () => {
  assertEquals(passwordRole(SUPER_PASSWORD), "super_admin");
  assertEquals(passwordRole(LEADER_PASSWORD), "leader");
  assertEquals(passwordRole(WELCOMING_PASSWORD), "welcoming");
  assertEquals(passwordRole("nope"), null);
  assertEquals(passwordRole(""), null);
});

Deno.test("passwordGrant: the 장년부 password is a super_admin in the adult partition", () => {
  assertEquals(passwordGrant(ADULT_PASSWORD), { role: "super_admin", partition: "adult" });
  assertEquals(passwordGrant(SUPER_PASSWORD), { role: "super_admin", partition: "youth" });
  assertEquals(passwordGrant(LEADER_PASSWORD), { role: "leader", partition: "youth" });
  assertEquals(passwordGrant(WELCOMING_PASSWORD), { role: "welcoming", partition: "youth" });
  assertEquals(passwordGrant("nope"), null);
});

Deno.test("MASTER_PASSWORD aliases the welcoming password (back-compat)", () => {
  assertEquals(MASTER_PASSWORD, WELCOMING_PASSWORD);
});

Deno.test("verifyAdmin: wrong password is rejected (no DB hit)", async () => {
  const r = await verifyAdmin(mockSb({}), "DEV-anything", "nope");
  assertEquals(r, null);
});

Deno.test("verifyAdmin: super password grants break-glass 'super_admin' from an unregistered device", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", SUPER_PASSWORD);
  assertEquals(r, { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth" });
});

Deno.test("verifyAdmin: leader password grants break-glass 'leader' from an unregistered device", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", LEADER_PASSWORD);
  assertEquals(r, { memberId: "", role: "leader", group: "", subgroup: "", ministry: "", partition: "youth" });
});

Deno.test("verifyAdmin: welcoming password grants break-glass 'welcoming' from an unregistered device", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", WELCOMING_PASSWORD);
  assertEquals(r, { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth" });
});

Deno.test("verifyAdmin: the 장년부 password lands in the adult partition", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", ADULT_PASSWORD);
  assertEquals(r, { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult" });
});

Deno.test("verifyAdmin: either password works on a ROSTER/blank device too", async () => {
  assertEquals((await verifyAdmin(mockSb({}), "ROSTER-12", LEADER_PASSWORD))?.role, "leader");
  assertEquals((await verifyAdmin(mockSb({}), "", WELCOMING_PASSWORD))?.role, "welcoming");
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
  assertEquals(r, {
    memberId: "m1", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM", partition: "youth",
  });
});

Deno.test("verifyAdmin: a 장년부 리더's phone keeps that scope under the 장년부 password", async () => {
  const r = await verifyAdmin(
    mockSb({
      devices: { member_id: "a1" },
      member_roles: { role: "leader", group_name: ADULT_GROUP, subgroup: "1구역", ministry: "" },
    }),
    "DEV-KNOWN-02",
    ADULT_PASSWORD,
  );
  assertEquals(r, {
    memberId: "a1", role: "leader", group: ADULT_GROUP, subgroup: "1구역", ministry: "", partition: "adult",
  });
});

Deno.test("verifyAdmin: a device's grant never crosses partitions", async () => {
  // The 장년부 password typed on a 청년부 리더's phone must NOT hand back the 청년부 scope.
  const crossed = await verifyAdmin(
    mockSb({
      devices: { member_id: "m1" },
      member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" },
    }),
    "DEV-KNOWN-01",
    ADULT_PASSWORD,
  );
  assertEquals(crossed, {
    memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult",
  });
  // …and the 대학·청년부 super password on a 장년부 리더's phone falls back the same way.
  const other = await verifyAdmin(
    mockSb({
      devices: { member_id: "a1" },
      member_roles: { role: "leader", group_name: ADULT_GROUP, subgroup: "1구역", ministry: "" },
    }),
    "DEV-KNOWN-02",
    SUPER_PASSWORD,
  );
  assertEquals(other?.partition, "youth");
  assertEquals(other?.memberId, "");
});

Deno.test("super_admin sees their whole partition — everything except 장년부", () => {
  const s: Role = { memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth" };
  assertEquals(scopeFilter(s, false), YOUTH_ALL);
});

Deno.test("pastor sees the 대학·청년부 roster (read-only is enforced elsewhere)", () => {
  const s: Role = { memberId: "m", role: "pastor", group: "", subgroup: "", ministry: "", partition: "youth" };
  assertEquals(scopeFilter(s, false), YOUTH_ALL);
});

Deno.test("staff (break-glass) sees the whole 대학·청년부 roster, like super/pastor", () => {
  const s: Role = { memberId: "", role: "staff", group: "", subgroup: "", ministry: "", partition: "youth" };
  assertEquals(scopeFilter(s, false), YOUTH_ALL);
  assertEquals(scopeFilter(s, true), YOUTH_ALL);
});

Deno.test("break-glass leader/welcoming (no memberId) see the whole 대학·청년부 roster", () => {
  const bgLeader: Role = { memberId: "", role: "leader", group: "", subgroup: "", ministry: "", partition: "youth" };
  const bgWelcoming: Role = { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth" };
  assertEquals(scopeFilter(bgLeader, false), YOUTH_ALL);
  assertEquals(scopeFilter(bgLeader, true), YOUTH_ALL);
  assertEquals(scopeFilter(bgWelcoming, false), YOUTH_ALL);
  assertEquals(scopeFilter(bgWelcoming, true), YOUTH_ALL);
});

Deno.test("leader is scoped to their group+subgroup in semester mode", () => {
  assertEquals(scopeFilter(leader, false), { all: false, groups: ["청년부"], subgroup: "건영동산" });
});

Deno.test("KM leader spans both depts in summer mode (합동)", () => {
  assertEquals(scopeFilter(leader, true), { all: false, groups: ["대학부", "청년부"], subgroup: "건영동산" });
});

Deno.test("합동 leader spans both 부서 in EVERY season (임원 account)", () => {
  const s: Role = { memberId: "m", role: "leader", group: "합동", subgroup: "", ministry: "KM", partition: "youth" };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
  assertEquals(scopeFilter(s, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
});

Deno.test("welcoming is scoped to its group in semester mode (봄/가을동산)", () => {
  const s: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM", partition: "youth" };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["청년부"], subgroup: "" });
});

Deno.test("welcoming spans both 부서 in summer mode (여름동산 합동)", () => {
  const univ: Role = { memberId: "m", role: "welcoming", group: "대학부", subgroup: "", ministry: "KM", partition: "youth" };
  const young: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM", partition: "youth" };
  assertEquals(scopeFilter(univ, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
  assertEquals(scopeFilter(young, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
});

Deno.test("장년부 admins are pinned to 장년부 — summer 합동 never applies", () => {
  const adultSuper: Role = {
    memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult",
  };
  assertEquals(scopeFilter(adultSuper, false), { all: false, groups: [ADULT_GROUP], subgroup: "" });
  assertEquals(scopeFilter(adultSuper, true), { all: false, groups: [ADULT_GROUP], subgroup: "" });
  // a 장년부 리더 additionally keeps their 동산
  const adultLeader: Role = {
    memberId: "a1", role: "leader", group: ADULT_GROUP, subgroup: "1구역", ministry: "", partition: "adult",
  };
  assertEquals(scopeFilter(adultLeader, true), { all: false, groups: [ADULT_GROUP], subgroup: "1구역" });
});

Deno.test("inScope: the two partitions can never see each other", () => {
  const youth = scopeFilter(
    { memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth" },
    false,
  );
  const adult = scopeFilter(
    { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult" },
    false,
  );
  assertEquals(inScope(youth, "청년부", "건영동산"), true);
  assertEquals(inScope(youth, ""), true); // guests / 미지정 stay with 대학·청년부
  assertEquals(inScope(youth, ADULT_GROUP), false);
  assertEquals(inScope(adult, ADULT_GROUP, "1구역"), true);
  assertEquals(inScope(adult, "청년부"), false);
  assertEquals(inScope(adult, ""), false);
});

Deno.test("inScope: a 동산-scoped leader only reaches their own 동산", () => {
  const s = scopeFilter(leader, false);
  assertEquals(inScope(s, "청년부", "건영동산"), true);
  assertEquals(inScope(s, "청년부", "다른동산"), false);
  assertEquals(inScope(s, "대학부", "건영동산"), false);
});

// 목적지 부서 검사는 동산을 보지 않는다: 동산에 묶인 리더가 자기 부서에 새가족을 등록할 때
// 동산은 아직 정해지지 않았고, 멤버 정보를 고쳐 저장할 때도 부서 칸은 늘 함께 실려 온다.
// 여기서 동산까지 요구하면 그 평범한 저장들이 전부 403이 된다.
Deno.test("inScopeGroup: 목적지 부서만 본다 — 동산은 묻지 않는다", () => {
  const s = scopeFilter(leader, false);
  assertEquals(inScopeGroup(s, "청년부"), true);   // 동산 없이도 통과
  assertEquals(inScope(s, "청년부"), false);        // inScope는 여전히 동산을 요구한다
  assertEquals(inScopeGroup(s, "대학부"), false);   // 다른 부서는 그대로 막힌다
  const adult = scopeFilter(
    { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult" },
    false,
  );
  assertEquals(inScopeGroup(adult, ADULT_GROUP), true);
  assertEquals(inScopeGroup(adult, "청년부"), false);
});

Deno.test("canViewLoginLog: only the designated member, and only as super_admin", () => {
  const viewer: Role = {
    memberId: LOGIN_LOG_VIEWER_MEMBER_ID, role: "super_admin", group: "대학부", subgroup: "호연동산", ministry: "",
    partition: "youth",
  };
  assertEquals(canViewLoginLog(viewer), true);
  // any other super admin is denied — this is not a role-wide feature
  assertEquals(canViewLoginLog({ ...viewer, memberId: "someone-else" }), false);
  // the designated member without super_admin (e.g. a demoted role) is denied
  assertEquals(canViewLoginLog({ ...viewer, role: "leader" }), false);
  // the shared super password on an unlinked device (memberId "") is denied: the login
  // isn't attributable to him, and anyone could have typed it
  assertEquals(canViewLoginLog({ ...viewer, memberId: "" }), false);
  assertEquals(canViewLoginLog(null), false);
});
