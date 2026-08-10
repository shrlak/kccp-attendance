// Admin auth + scope helpers for the hardened edge function (spec D1).
//
// Two auth paths, tried in order by resolveAdmin():
//   1. Google JWT (Bearer token): email → members.email → member_roles → role/scope.
//   2. Break-glass: a shared team password alone — works on ANY device, registered or not.
//      There are four passwords, each landing on a different dashboard:
//        • SUPER_PASSWORD      → "super_admin" role (full panel: settings, admins, backup…)
//        • LEADER_PASSWORD     → "leader"      role (리더 dashboard)
//        • WELCOMING_PASSWORD  → "welcoming"   role (새가족팀 dashboard)
//        • ADULT_PASSWORD      → "super_admin" role in the **장년부 partition** (see below)
//      A device that happens to be linked to a roled member keeps that member's scope;
//      otherwise the login gets the password's break-glass role. The three 대학·청년부
//      passwords see that ministry's whole roster (a shared password can't pin to one
//      동산); only SUPER_PASSWORD grants the super_admin powers (settings, admin
//      management, 동산지기/임원, backup).
// Public check-in stays anonymous and PII-free.
//
// ── PARTITIONS (부) ──────────────────────────────────────────────────────────────────
// The app serves two departments and they must never see each other's people:
// 대학·청년부 ("youth") and 장년부 ("adult"). **The boundary is the Postgres schema.**
// 대학·청년부 lives in `public`, 장년부 in `adult` (migration 20260807) — separate tables,
// separate sequences, separate backups. Reading `public.members` with no filter at all
// returns zero 장년부 people, because they are not in that table.
//
// Every admin carries the partition their credentials belong to (`Role.partition`), and
// `dbOf(sb, partition)` is the single place that turns it into a database handle. Get that
// right and the rest follows: a query can't reach across departments even if someone
// forgets a WHERE clause.
//
// scopeFilter()/inScope() still exist and still matter — they carry the 동산/셀 scoping a
// 리더 needs *within* their own department, and they double as belt-and-braces on the 부서
// (`{all:true, exclude:['장년부']}` for a youth super). But the schema is the real wall.
//
// Wired into index.ts (imports resolveAdmin + dbOf + scopeFilter + inScope) and unit-tested
// (auth.test.ts).

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
//  SHARED TEAM PASSWORDS — change these lines to rotate them (or set the matching env
//  vars to override without editing code). Each grants admin access from ANY device and
//  lands on its own dashboard, so treat them as secrets and rotate if leaked:
//    • SUPER_PASSWORD     → the full super-admin panel (대학·청년부)
//    • LEADER_PASSWORD    → the 리더(leader) dashboard (대학·청년부)
//    • WELCOMING_PASSWORD → the 새가족팀(welcoming) dashboard (대학·청년부)
//    • ADULT_PASSWORD     → the 장년부 panel: the same admin surface, but every query is
//                           pinned to the 장년부 partition, so it never shows — and can
//                           never touch — a 대학부/청년부 member (and vice versa).
export const SUPER_PASSWORD = Deno.env.get("SUPER_PASSWORD") ?? "kccpadmin";
export const LEADER_PASSWORD = Deno.env.get("LEADER_PASSWORD") ?? "kccpleaders";
export const WELCOMING_PASSWORD =
  Deno.env.get("WELCOMING_PASSWORD") ?? Deno.env.get("MASTER_PASSWORD") ?? "kccpwelcome";
export const ADULT_PASSWORD = Deno.env.get("ADULT_PASSWORD") ?? "kccpadults";
// Backwards-compat alias for the legacy single break-glass credential (now the welcoming
// password). Kept so older references / env overrides keep working.
export const MASTER_PASSWORD = WELCOMING_PASSWORD;
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  CROSS-PARTITION EMAILS — 두 부를 다 보는 사람.
//
//  보통 한 사람은 한 부에만 산다: 이메일이 어느 스키마의 members에서 나오느냐가 곧 그 사람의
//  부이고, 그것 말고 부에 속하는 길은 없다. 그런데 두 부를 다 맡는 사람이 하나 있다 — 그
//  사람은 로그인한 뒤 **어느 부의 패널로 들어갈지 고른다.**
//
//  두 번째 members 행을 만들어 주는 방법은 쓰지 않았다: 그러면 장년부 명단에 실제 교인이
//  아닌 사람이 한 명 늘고, 출석부·통계·백업이 전부 그 사람을 세게 된다. 부를 고르는 것은
//  **명단이 아니라 신원의 성질**이므로 여기, 인증 쪽에 둔다.
//
//  구글 로그인에만 적용된다. 공용 비밀번호는 그 자체가 부를 뜻하므로(ADULT_PASSWORD →
//  장년부) 고를 것이 없고, 무엇보다 아무나 칠 수 있는 값이라 신원이 아니다.
export const CROSS_PARTITION_EMAILS = readEmails(
  Deno.env.get("CROSS_PARTITION_EMAILS") ?? "spencerkim1235@gmail.com",
);

function readEmails(raw: string): Set<string> {
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// May this email pick its 부 at sign-in? Case-insensitive: Google hands back whatever
// casing the account was typed with, and an address is not case-sensitive.
export function canCrossPartitions(email: string | null | undefined): boolean {
  return !!email && CROSS_PARTITION_EMAILS.has(email.trim().toLowerCase());
}

// A partition name off the wire (the X-Partition header) → the value, or null for anything
// else. The header is a *request*, never a grant: only canCrossPartitions() honors it.
export function readPartition(raw: string | null | undefined): Partition | null {
  const v = (raw || "").trim().toLowerCase();
  return v === "adult" ? "adult" : v === "youth" ? "youth" : null;
}
// ─────────────────────────────────────────────────────────────────────────────

// The 부서 that makes up the 장년부 partition. Everything else is the youth partition.
export const ADULT_GROUP = "장년부";
// 장년부의 표가 사는 스키마. 대학·청년부는 기본 스키마(public)를 그대로 쓴다.
export const ADULT_SCHEMA = "adult";
export type Partition = "youth" | "adult";

// Which partition a 부서 belongs to. The empty/unknown 부서 (guests, legacy rows, staff
// with no 부서) stays with 대학·청년부, which is where those rows have always shown up.
export function partitionOfGroup(group: string | null | undefined): Partition {
  return (group || "") === ADULT_GROUP ? "adult" : "youth";
}

// **The one place a 부 becomes a database handle.** Everything the two departments own —
// 사람·기기·출석·권한·설정·감사기록 — is reached through this, so a query is scoped to a
// department by construction rather than by remembering a filter.
//
// A stored admin grant no longer needs a 부서 to say which 부 it belongs to: it belongs to
// the schema it was found in.
// deno-lint-ignore no-explicit-any
export function dbOf(sb: any, partition: Partition): any {
  return partition === "adult" ? sb.schema(ADULT_SCHEMA) : sb;
}

// Map a typed password to the break-glass grant it confers, or null if it matches none.
// Checked super → leader → welcoming → adult so the higher-privilege match wins if two
// passwords are (mis)configured identically.
export function passwordGrant(
  password: string,
): { role: "super_admin" | "leader" | "welcoming"; partition: Partition } | null {
  if (!password) return null;
  if (password === SUPER_PASSWORD) return { role: "super_admin", partition: "youth" };
  if (password === LEADER_PASSWORD) return { role: "leader", partition: "youth" };
  if (password === WELCOMING_PASSWORD) return { role: "welcoming", partition: "youth" };
  // 장년부 runs its own department end to end, so its shared password is a super_admin —
  // inside the 장년부 partition only. scopeFilter pins it to 장년부 regardless of role.
  if (password === ADULT_PASSWORD) return { role: "super_admin", partition: "adult" };
  return null;
}

// The role a password grants, ignoring its partition. Kept as the narrow helper older
// call sites (and tests) use; passwordGrant is the full answer.
export function passwordRole(password: string): "super_admin" | "leader" | "welcoming" | null {
  return passwordGrant(password)?.role ?? null;
}

// Roles. "staff" is a legacy combined 리더+새가족팀 break-glass role (no longer minted by the
// password path, which now grants "leader"/"welcoming" directly — kept for back-compat).
// Distinct from a member's is_staff flag, which is unrelated.
export type AdminRole = "super_admin" | "leader" | "pastor" | "welcoming" | "staff";

export interface Role {
  memberId: string;
  role: AdminRole;
  group: string;
  subgroup: string;
  ministry: string;
  // 대학·청년부 or 장년부. Every row this admin may read or write lives in this partition;
  // see scopeFilter/inScope. Derived, never sent by the client — except that a
  // cross-partition email may *ask* for one of the two (see CROSS_PARTITION_EMAILS).
  partition: Partition;
  // The verified Google email this login came in on. Identity, not scope: it decides
  // whether the login may choose its 부 at all. Absent ⇒ a password login, which never can.
  email?: string;
  // The schema `memberId` actually lives in. Normally the same as `partition`; they differ
  // for exactly one case — a cross-partition login working in the *other* 부, where the
  // person is still their own member row back home. Anything that resolves the member (the
  // sign-in log's name) must read this, not `partition`. Absent ⇒ the two are the same.
  memberPartition?: Partition;
}

// What an admin may see. `all` is "the whole partition", which is not the whole table:
// `exclude` lists the 부서 that belong to the OTHER partition and must be filtered out.
export type Scope =
  | { all: true; exclude: string[] }
  | { all: false; groups: string[]; subgroup: string };

// Any device id that is NOT a ROSTER-## seed stub is a real personal device. Admin
// roles may only ever attach to personal devices — never to ROSTER placeholders.
export function isPersonalDevice(deviceId: string): boolean {
  return !!deviceId && !deviceId.startsWith("ROSTER-");
}

// Mirror of the legacy browser ACL, now partition-first:
//
// • 장년부 admins are pinned to 장년부 — always, whatever their role. A 장년부 리더 is
//   additionally pinned to their 동산; every other 장년부 role sees the whole 장년부
//   roster. 여름 합동 never applies here (that is a 대학·청년부 arrangement).
// • 대학·청년부 super/pastor/staff see everything in their partition, i.e. everything
//   EXCEPT 장년부 — which is why `all` carries an `exclude` list instead of meaning
//   "no filter at all".
// • A 대학·청년부 leader or 새가족팀(welcoming) member is scoped to their 부서 + 동산.
//   A "합동" group spans BOTH 대학부·청년부 in EVERY season (the shared 임원 account); in
//   summer mode a 대학부/청년부 scope is likewise promoted to 합동 — so during 여름동산 a
//   새가족팀원 sees both 부서, while in 봄/가을동산 a 대학부 새가족팀원 sees only 대학부
//   and a 청년부 새가족팀원 only 청년부. The subgroup always pins to their 동산.
export function scopeFilter(role: Role, summerMode: boolean): Scope {
  if (role.partition === "adult") {
    // A 장년부 리더 with a stored 동산 keeps that 동산; the shared 장년부 password (and
    // every other 장년부 role) sees the whole 장년부 roster.
    const subgroup = role.role === "leader" ? role.subgroup : "";
    return { all: false, groups: [ADULT_GROUP], subgroup };
  }
  // super/pastor see their whole partition; staff (legacy break-glass) too.
  if (role.role === "super_admin" || role.role === "pastor" || role.role === "staff") {
    return { all: true, exclude: [ADULT_GROUP] };
  }
  // Password-only (break-glass) leader/welcoming logins have no linked member (memberId="")
  // to scope to, so they see the whole 대학·청년부 roster — a shared team password can't pin
  // to one person's 부서/동산. Real roled leaders/welcoming members always carry a memberId.
  if ((role.role === "leader" || role.role === "welcoming") && !role.memberId) {
    return { all: true, exclude: [ADULT_GROUP] };
  }
  if (role.role === "leader" || role.role === "welcoming") {
    const combined = role.group === "합동" ||
      (summerMode && (role.group === "대학부" || role.group === "청년부"));
    const groups = combined ? ["대학부", "청년부"] : [role.group].filter(Boolean);
    return { all: false, groups, subgroup: role.subgroup };
  }
  // any other scoped role
  return { all: false, groups: [role.group].filter(Boolean), subgroup: role.subgroup };
}

// Is this 부서/동산 inside the scope? THE membership test — every per-row authorization
// check in index.ts goes through here, super admins included, because `all` no longer
// means "everything in the table" (it excludes the other partition).
export function inScope(scope: Scope, group: string | null | undefined, subgroup?: string | null): boolean {
  if (!inScopeGroup(scope, group)) return false;
  if (!scope.all && scope.subgroup && (subgroup || "") !== scope.subgroup) return false;
  return true;
}

// The 부서 half of the test on its own — "may this admin file someone under this 부서?".
// Used where the thing being checked is a DESTINATION rather than an existing row: the 부서
// a member is being moved to, a 새가족 is being registered into, a 방문자 is tagged with.
// Deliberately ignores the 동산: a 동산-scoped 리더 registering a 새가족 in their own 부서
// hasn't picked a 동산 yet (it's assigned later), and requiring one would reject the save.
export function inScopeGroup(scope: Scope, group: string | null | undefined): boolean {
  const g = group || "";
  if (scope.all) return !scope.exclude.includes(g);
  return scope.groups.includes(g);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN-LOG VIEWER — the sign-in history (who logged in, when, from which IP and
//  approximate place) is personal-audit data, so it is NOT a general super-admin feature:
//  only 김호연 may read it. He is pinned by his members-table UUID (env-overridable), and
//  the sign-in must be attributable to that member row — via his linked personal device or
//  his Google email. A shared team password typed on an unlinked device (memberId "")
//  never qualifies, even though it grants super_admin, because anyone could type it.
//
//  login_log는 부서를 가리지 않는 **시스템 전체의 기록**(공용 표)이라 어느 부의 패널에서 보든
//  같은 목록이다. 그래서 이 사람이 부를 건너가도 권한이 따라간다 — memberId에 걸려 있고, 그
//  UUID는 부를 건너가도 그대로이기 때문이다 (memberPartition이 그 행이 사는 곳을 가리킨다).
export const LOGIN_LOG_VIEWER_MEMBER_ID =
  Deno.env.get("LOGIN_LOG_VIEWER_MEMBER_ID") ?? "e45e9708-9d44-418d-9ff5-734adf81fa68"; // 김호연
// ─────────────────────────────────────────────────────────────────────────────

export function canViewLoginLog(role: Role | null): boolean {
  return !!role && role.role === "super_admin" && !!role.memberId &&
    role.memberId === LOGIN_LOG_VIEWER_MEMBER_ID;
}

// 로그인한 뒤 부를 고를 수 있는가 — 패널이 "어느 부로 들어갈까요" 화면을 띄울지 정하는 값.
// 구글 로그인에만 해당한다 (비밀번호 로그인은 role.email이 비어 있다).
export function canChoosePartition(role: Role | null): boolean {
  return !!role && canCrossPartitions(role.email);
}

type SB = ReturnType<typeof createClient>;

// Verify an admin via a shared team password. Any of the four passwords grants access
// from ANY device — no registration required and the device id is irrelevant (so staff can
// sign in from a phone, a borrowed laptop, a fresh browser, etc.). If the device happens to
// be a personal one linked to a member who holds a scoped role, that member's scope is
// preserved; otherwise the login gets the role the password maps to (SUPER_PASSWORD →
// "super_admin", LEADER_PASSWORD → "leader", WELCOMING_PASSWORD → "welcoming",
// ADULT_PASSWORD → "super_admin" in the 장년부 partition). Returns null only when the
// password matches none of them.
export async function verifyAdmin(sb: SB, deviceId: string, password: string): Promise<Role | null> {
  const grant = passwordGrant(password);
  if (!grant) return null;
  if (isPersonalDevice(deviceId)) {
    // Look only in the schema the typed password belongs to. That is what keeps a device's
    // stored grant from crossing departments: the 장년부 password on a 청년부 리더's phone
    // searches `adult.devices`, doesn't find them, and falls through to break-glass.
    const db = dbOf(sb, grant.partition);
    const { data: dev } = await db.from("devices").select("member_id").eq("id", deviceId).single();
    const memberId = (dev as { member_id?: string } | null)?.member_id;
    if (memberId) {
      const { data: r } = await db.from("member_roles").select("*").eq("member_id", memberId).single();
      if (r) {
        const row = r as { role: AdminRole; group_name?: string; subgroup?: string; ministry?: string };
        return {
          memberId,
          role: row.role,
          group: row.group_name || "",
          subgroup: row.subgroup || "",
          ministry: row.ministry || "",
          partition: grant.partition,
          email: "",
          memberPartition: grant.partition,
        };
      }
    }
  }
  // Break-glass: correct team password on a device with no linked admin role → the role the
  // password maps to, scoped to that password's partition. memberId is empty (no member to
  // attribute) — safe because every role.memberId lookup downstream is gated behind a
  // leader/welcoming/staff role check (super_admin paths key off role.role and audit via
  // the device id), and scopeFilter still pins the login to its own partition.
  return {
    memberId: "",
    role: grant.role,
    group: "",
    subgroup: "",
    ministry: "",
    partition: grant.partition,
    email: "",
    memberPartition: grant.partition,
  };
}

// Verify via Supabase JWT (Google sign-in path). Resolves email → member → role. Both
// departments are searched, 대학·청년부 first; **whichever schema the member turns up in is
// the 부 they get** — there is no other way to belong to one. 그러니 어떤 이메일을 어느
// 스키마의 멤버에 붙이느냐가 곧 "이 사람은 로그인하면 어느 부를 보는가"이다.
//
// 예외가 하나 있다: CROSS_PARTITION_EMAILS의 이메일은 `wanted`로 부를 **고른다.** 고른 부에
// 자기 members 행이 없으면(보통 그렇다 — 그 사람은 한쪽 부의 교인이다) 그 부의 super_admin
// 으로 들어가되, 저쪽 부의 자리를 뜻하는 부서·동산은 지우고 간다. memberId는 그대로 들고
// 가고 memberPartition이 그 행이 사는 스키마를 가리킨다 — 로그인 기록에 이름이 남아야 하고,
// 로그인 기록 열람 권한도 그 UUID에 걸려 있기 때문이다.
export async function verifyAdminJwt(sb: SB, jwt: string, wanted?: Partition | null): Promise<Role | null> {
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user?.email) return null;
  const email = user.email;
  const cross = canCrossPartitions(email);
  // 고를 수 있는 사람이 고른 부를 먼저 찾는다 — 양쪽에 행이 있다면 고른 쪽이 이겨야 한다.
  const order: Partition[] = cross && wanted === "adult" ? ["adult", "youth"] : ["youth", "adult"];
  for (const partition of order) {
    const db = dbOf(sb, partition);
    // 사람 하나가 이메일 둘을 쓸 수 있다 (사역용 · 개인용). 어느 쪽으로 들어와도 같은 사람이다
    // — 20260811의 email_alt. 따옴표로 감싸 값 안의 쉼표·괄호가 필터 문법으로 읽히지 않게 한다.
    const needle = email.replace(/["\\]/g, "");
    const { data: member } = await db
      .from("members")
      .select("id")
      .or(`email.ilike."${needle}",email_alt.ilike."${needle}"`)
      .limit(1)
      .maybeSingle();
    const memberId = (member as { id?: string } | null)?.id;
    if (!memberId) continue;
    const { data: r } = await db.from("member_roles").select("*").eq("member_id", memberId).single();
    if (!r) continue;
    const row = r as { role: AdminRole; group_name?: string; subgroup?: string; ministry?: string };
    const home: Role = {
      memberId,
      role: row.role,
      group: row.group_name || "",
      subgroup: row.subgroup || "",
      ministry: row.ministry || "",
      partition,
      email,
      memberPartition: partition,
    };
    // 고를 수 있는 사람이 자기 행이 없는 쪽을 골랐다: 그 부의 super_admin으로 건너간다.
    // 부서·동산을 비우는 이유 — 그것들은 **저쪽 부의 이름**이라 여기서는 뜻이 없고, 남겨 두면
    // scopeFilter가 있지도 않은 동산으로 명단을 좁힐 수 있다. (장년부 super_admin은 부서·동산
    // 없이 자기 부 전체를 본다.)
    if (cross && wanted && wanted !== partition) {
      return { ...home, role: "super_admin", group: "", subgroup: "", ministry: "", partition: wanted };
    }
    return home;
  }
  return null;
}

// Unified resolver: try Google JWT first (Authorization: Bearer), fall back to
// device + master password. All hardened admin endpoints call this.
//
// X-Partition is the panel's *request* for a 부, sent on every call once a cross-partition
// admin has picked one. It is not a grant and cannot become one: verifyAdminJwt honors it
// only for CROSS_PARTITION_EMAILS, and the password path ignores it outright (a password
// already says which 부 it is).
export async function resolveAdmin(sb: SB, req: Request): Promise<Role | null> {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    return verifyAdminJwt(sb, auth.slice(7), readPartition(req.headers.get("x-partition")));
  }
  const deviceId = req.headers.get("x-device-id") || req.headers.get("X-Device-Id") || "";
  return verifyAdmin(sb, deviceId, req.headers.get("x-admin-password") || "");
}
