// Run with: deno test supabase/functions/attendance-api/auth.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import {
  ADULT_GROUP,
  ADULT_PASSWORD,
  ADULT_SCHEMA,
  isPersonalDevice,
  inScope,
  inScopeGroup,
  partitionOfGroup,
  scopeFilter,
  dbOf,
  verifyAdmin,
  passwordGrant,
  passwordRole,
  canViewLoginLog,
  canAssignDongsan,
  canReadDongsanNames,
  canChoosePartition,
  canCrossPartitions,
  readPartition,
  verifyAdminJwt,
  CROSS_PARTITION_EMAILS,
  LOGIN_LOG_VIEWER_MEMBER_ID,
  SUPER_PASSWORD,
  WELCOMING_PASSWORD,
  MASTER_PASSWORD,
  type Role,
  type Scope,
} from "./auth.ts";

const leader: Role = {
  memberId: "m", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM", partition: "youth",
};
// 두 부를 다 맡는 계정의 이메일 — 기본값 하나뿐이지만, 목록에서 읽어 와 환경변수로 바꿔도
// 테스트가 따라가게 한다.
const CROSS_EMAIL = [...CROSS_PARTITION_EMAILS][0];
// 대학·청년부 "everything" is everything except the other partition.
const YOUTH_ALL: Scope = { all: true, exclude: [ADULT_GROUP] };

// Minimal chainable Supabase stub. `data` is the public (대학·청년부) schema; `adultData`
// is what `.schema('adult')` sees — the two are genuinely different tables here, which is
// the whole point of the split.
// deno-lint-ignore no-explicit-any
function mockSb(data: Record<string, any>, adultData: Record<string, any> = {}, email?: string): any {
  // deno-lint-ignore no-explicit-any
  const handle = (rows: Record<string, any>): any => ({
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        or: () => chain,
        limit: () => chain,
        single: () => Promise.resolve({ data: rows[table] ?? null }),
        maybeSingle: () => Promise.resolve({ data: rows[table] ?? null }),
      };
      return chain;
    },
  });
  const publicHandle = handle(data);
  return {
    ...publicHandle,
    schema: (name: string) => (name === "adult" ? handle(adultData) : publicHandle),
    auth: { getUser: () => Promise.resolve({ data: { user: email ? { email } : null } }) },
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

Deno.test("passwordRole: maps each password to its break-glass role", () => {
  assertEquals(passwordRole(SUPER_PASSWORD), "super_admin");
  assertEquals(passwordRole(WELCOMING_PASSWORD), "welcoming");
  assertEquals(passwordRole("nope"), null);
  assertEquals(passwordRole(""), null);
});

Deno.test("passwordGrant: the 장년부 password is a super_admin in the adult partition", () => {
  assertEquals(passwordGrant(ADULT_PASSWORD), { role: "super_admin", partition: "adult" });
  assertEquals(passwordGrant(SUPER_PASSWORD), { role: "super_admin", partition: "youth" });
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
  assertEquals(r, { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth", email: "", memberPartition: "youth" });
});

Deno.test("verifyAdmin: welcoming password grants break-glass 'welcoming' from an unregistered device", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", WELCOMING_PASSWORD);
  assertEquals(r, { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth", email: "", memberPartition: "youth" });
});

Deno.test("verifyAdmin: the 장년부 password lands in the adult partition", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", ADULT_PASSWORD);
  assertEquals(r, { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult", email: "", memberPartition: "adult" });
});

Deno.test("verifyAdmin: a password works on a ROSTER/blank device too", async () => {
  assertEquals((await verifyAdmin(mockSb({}), "ROSTER-12", SUPER_PASSWORD))?.role, "super_admin");
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
    email: "", memberPartition: "youth",
  });
});

Deno.test("verifyAdmin: a 장년부 리더's phone keeps that scope under the 장년부 password", async () => {
  const r = await verifyAdmin(
    mockSb({}, {
      devices: { member_id: "a1" },
      member_roles: { role: "leader", group_name: ADULT_GROUP, subgroup: "1셀", ministry: "" },
    }),
    "DEV-KNOWN-02",
    ADULT_PASSWORD,
  );
  assertEquals(r, {
    memberId: "a1", role: "leader", group: ADULT_GROUP, subgroup: "1셀", ministry: "", partition: "adult",
    email: "", memberPartition: "adult",
  });
});

Deno.test("verifyAdmin: a device's grant never crosses partitions", async () => {
  // 장년부 비밀번호는 adult 스키마만 뒤진다. 청년부 리더의 기기 기록은 public에 있으므로
  // 찾지 못하고 break-glass로 떨어진다 — 스키마가 곧 경계다.
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
    email: "", memberPartition: "adult",
  });
  // …그리고 그 반대도 마찬가지.
  const other = await verifyAdmin(
    mockSb({}, {
      devices: { member_id: "a1" },
      member_roles: { role: "leader", group_name: ADULT_GROUP, subgroup: "1셀", ministry: "" },
    }),
    "DEV-KNOWN-02",
    SUPER_PASSWORD,
  );
  assertEquals(other?.partition, "youth");
  assertEquals(other?.memberId, "");
});

// dbOf가 부(部)를 데이터베이스 손잡이로 바꾸는 유일한 자리다.
Deno.test("dbOf: 장년부만 adult 스키마로 간다", () => {
  const marker = { schema: (name: string) => ({ picked: name }) };
  assertEquals(dbOf(marker, "adult"), { picked: ADULT_SCHEMA });
  assertEquals(dbOf(marker, "youth"), marker);
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

Deno.test("canAssignDongsan: 새가족팀도 배정한다 — 동산지기만 빠진다", () => {
  // 최고관리자와 staff(공용 비밀번호 레거시)는 지기 여부와 무관하게 언제나 배정한다.
  assertEquals(canAssignDongsan("super_admin", false), true);
  assertEquals(canAssignDongsan("super_admin", true), true);
  assertEquals(canAssignDongsan("staff", true), true);
  // 새가족팀: 리더와 같은 자격 — 지기가 아니면 배정하고, 지기면 못 한다.
  assertEquals(canAssignDongsan("welcoming", false), true);
  assertEquals(canAssignDongsan("welcoming", true), false);
  assertEquals(canAssignDongsan("leader", false), true);
  assertEquals(canAssignDongsan("leader", true), false);
  // 목사는 읽기 전용이다.
  assertEquals(canAssignDongsan("pastor", false), false);
});

Deno.test("canReadDongsanNames: 배정하는 사람은 고를 이름을 볼 수 있다", () => {
  const base: Role = {
    memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth",
  };
  assertEquals(canReadDongsanNames(base), true);
  assertEquals(canReadDongsanNames({ ...base, role: "super_admin" }), true);
  assertEquals(canReadDongsanNames({ ...base, role: "staff" }), true);
  assertEquals(canReadDongsanNames({ ...base, role: "pastor" }), false);
  assertEquals(canReadDongsanNames(null), false);
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

// ── 두 부를 다 맡는 계정 ───────────────────────────────────────────────────────────────

Deno.test("canCrossPartitions: 지정된 이메일만, 대소문자는 가리지 않는다", () => {
  assertEquals(canCrossPartitions(CROSS_EMAIL), true);
  assertEquals(canCrossPartitions(CROSS_EMAIL.toUpperCase()), true);
  assertEquals(canCrossPartitions(`  ${CROSS_EMAIL}  `), true);
  assertEquals(canCrossPartitions("someone.else@gmail.com"), false);
  assertEquals(canCrossPartitions(""), false);
  assertEquals(canCrossPartitions(null), false);
});

Deno.test("readPartition: 헤더에서 오는 값은 둘 중 하나이거나 아무것도 아니다", () => {
  assertEquals(readPartition("adult"), "adult");
  assertEquals(readPartition("ADULT"), "adult");
  assertEquals(readPartition(" youth "), "youth");
  assertEquals(readPartition("public"), null);
  assertEquals(readPartition(""), null);
  assertEquals(readPartition(null), null);
});

Deno.test("verifyAdminJwt: 보통 계정은 자기 members 행이 있는 부를 그대로 받는다", async () => {
  const sb = mockSb(
    { members: { id: "m1" }, member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" } },
    {},
    "leader@example.com",
  );
  const r = await verifyAdminJwt(sb, "jwt");
  assertEquals(r?.partition, "youth");
  assertEquals(r?.memberId, "m1");
  assertEquals(r?.email, "leader@example.com");
  assertEquals(r?.memberPartition, "youth");
});

Deno.test("verifyAdminJwt: 고를 수 없는 계정은 X-Partition을 적어 보내도 건너가지 못한다", async () => {
  const sb = mockSb(
    { members: { id: "m1" }, member_roles: { role: "super_admin", group_name: "대학부", subgroup: "", ministry: "" } },
    {},
    "someone.else@gmail.com",
  );
  // 헤더는 요청일 뿐이다 — 이 이메일에게는 아무 효력이 없다.
  const r = await verifyAdminJwt(sb, "jwt", "adult");
  assertEquals(r?.partition, "youth");
});

Deno.test("verifyAdminJwt: 두 부를 다 맡는 계정은 고른 부로 들어간다", async () => {
  const sb = mockSb(
    { members: { id: LOGIN_LOG_VIEWER_MEMBER_ID }, member_roles: { role: "super_admin", group_name: "대학부", subgroup: "호연동산", ministry: "" } },
    {},
    CROSS_EMAIL,
  );
  // 고르지 않으면 지금까지와 똑같다: 자기 행이 있는 부.
  const home = await verifyAdminJwt(sb, "jwt");
  assertEquals(home?.partition, "youth");
  assertEquals(home?.group, "대학부");

  // 장년부를 고르면 장년부의 super_admin이 된다. 저쪽 부의 자리를 뜻하는 부서·동산은 지우고
  // 가되(여기서는 뜻이 없다), 사람 자체는 여전히 자기 행으로 남는다.
  const crossed = await verifyAdminJwt(sb, "jwt", "adult");
  assertEquals(crossed?.partition, "adult");
  assertEquals(crossed?.role, "super_admin");
  assertEquals(crossed?.group, "");
  assertEquals(crossed?.subgroup, "");
  assertEquals(crossed?.memberId, LOGIN_LOG_VIEWER_MEMBER_ID);
  assertEquals(crossed?.memberPartition, "youth"); // 이름은 여기서 찾아야 한다
});

Deno.test("두 부를 다 맡는 계정은 건너간 부에서도 로그인 기록을 본다", () => {
  // login_log는 부서를 가리지 않는 공용 표라, 어느 부의 패널에서 보든 같은 목록이다.
  const youth: Role = {
    memberId: LOGIN_LOG_VIEWER_MEMBER_ID, role: "super_admin", group: "대학부", subgroup: "호연동산",
    ministry: "", partition: "youth", email: CROSS_EMAIL, memberPartition: "youth",
  };
  const adult: Role = { ...youth, group: "", subgroup: "", partition: "adult" };
  assertEquals(canViewLoginLog(youth), true);
  assertEquals(canViewLoginLog(adult), true);
  // 장년부 공용 비밀번호는 여전히 안 된다 — 누구든 칠 수 있는 값이라 신원이 아니다.
  assertEquals(canViewLoginLog({ ...adult, memberId: "", email: undefined }), false);
});

Deno.test("canChoosePartition: 구글 로그인에만, 지정된 이메일에만 붙는다", () => {
  const base: Role = {
    memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth",
  };
  assertEquals(canChoosePartition({ ...base, email: CROSS_EMAIL }), true);
  assertEquals(canChoosePartition({ ...base, email: "someone.else@gmail.com" }), false);
  // 비밀번호 로그인에는 이메일이 없다 — 비밀번호 자체가 이미 부를 뜻한다.
  assertEquals(canChoosePartition({ ...base, email: "" }), false);
  assertEquals(canChoosePartition(base), false);
  assertEquals(canChoosePartition(null), false);
});

// ── 공용 비밀번호는 셋뿐이고, 저마다 자기 부의 것이다 ────────────────────────────────

Deno.test("리더 공용 비밀번호는 없다 — kccpleaders는 이제 아무것도 아니다", async () => {
  // 리더의 권한 범위는 자기 동산인데 공용 비밀번호는 사람을 가리키지 못한다. 그래서
  // 없앴고, 예전 값은 다른 틀린 비밀번호와 똑같이 거절된다.
  assertEquals(passwordGrant("kccpleaders"), null);
  assertEquals(passwordRole("kccpleaders"), null);
  assertEquals(await verifyAdmin(mockSb({}), "DEV-anything", "kccpleaders"), null);
  // 기기가 리더에게 묶여 있어도 마찬가지다 — 비밀번호가 먼저 통과해야 기기를 본다.
  const linked = await verifyAdmin(
    mockSb({
      devices: { member_id: "m1" },
      member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" },
    }),
    "DEV-KNOWN-01",
    "kccpleaders",
  );
  assertEquals(linked, null);
});

Deno.test("새가족팀 공용 비밀번호는 대학·청년부 전용이다", () => {
  assertEquals(passwordGrant(WELCOMING_PASSWORD)?.partition, "youth");
  // 그 비밀번호로 들어온 로그인이 보는 범위도 대학·청년부뿐 — 장년부는 빠진다.
  const scope = scopeFilter(
    { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth" },
    false,
  );
  assertEquals(inScopeGroup(scope, "대학부"), true);
  assertEquals(inScopeGroup(scope, "청년부"), true);
  assertEquals(inScopeGroup(scope, ADULT_GROUP), false);
});

Deno.test("공용 비밀번호는 셋 — 그 밖의 값은 전부 거절", async () => {
  const grants = [SUPER_PASSWORD, WELCOMING_PASSWORD, ADULT_PASSWORD].map((p) => passwordGrant(p));
  assertEquals(grants.filter(Boolean).length, 3);
  for (const wrong of ["kccpleaders", "kccpleader", "nope", " ", ""]) {
    assertEquals(await verifyAdmin(mockSb({}), "DEV-x", wrong), null);
  }
});
