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
// The app now serves two departments out of one database, and they must never see each
// other's people: 대학·청년부 ("youth") and 장년부 ("adult"). The partition is derived
// from the 부서 (`members.group_name`) — 장년부 is the adult partition, everything else
// (대학부 · 청년부 · EM · 미지정 …) is the youth partition — and every admin carries one.
// scopeFilter() is the single place that turns a role into the rows it may touch, and it
// now ALWAYS returns a meaningful scope, super admins included: a 대학·청년부 super gets
// `{all:true, exclude:['장년부']}`, a 장년부 admin gets `{all:false, groups:['장년부']}`.
// Callers must therefore never skip the scope check for super_admin — use inScope().
//
// Wired into index.ts (imports resolveAdmin + scopeFilter + inScope) and unit-tested
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

// The 부서 that makes up the 장년부 partition. Everything else is the youth partition.
export const ADULT_GROUP = "장년부";
export type Partition = "youth" | "adult";

// Which partition a 부서 belongs to. The empty/unknown 부서 (guests, legacy rows, staff
// with no 부서) stays with 대학·청년부, which is where those rows have always shown up.
export function partitionOfGroup(group: string | null | undefined): Partition {
  return (group || "") === ADULT_GROUP ? "adult" : "youth";
}

// Which partition an admin belongs to. A stored grant (member_roles) is 장년부's when its
// 부서 or 사역(ministry) says so; break-glass logins carry the partition their password
// maps to.
export function partitionOfRole(group: string, ministry: string): Partition {
  return group === ADULT_GROUP || ministry === ADULT_GROUP ? "adult" : "youth";
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
  // see scopeFilter/inScope. Derived, never sent by the client.
  partition: Partition;
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
export const LOGIN_LOG_VIEWER_MEMBER_ID =
  Deno.env.get("LOGIN_LOG_VIEWER_MEMBER_ID") ?? "e45e9708-9d44-418d-9ff5-734adf81fa68"; // 김호연
// ─────────────────────────────────────────────────────────────────────────────

export function canViewLoginLog(role: Role | null): boolean {
  return !!role && role.role === "super_admin" && !!role.memberId &&
    role.memberId === LOGIN_LOG_VIEWER_MEMBER_ID;
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
    const { data: dev } = await sb.from("devices").select("member_id").eq("id", deviceId).single();
    const memberId = (dev as { member_id?: string } | null)?.member_id;
    if (memberId) {
      const { data: r } = await sb.from("member_roles").select("*").eq("member_id", memberId).single();
      if (r) {
        const row = r as { role: AdminRole; group_name?: string; subgroup?: string; ministry?: string };
        const group = row.group_name || "", ministry = row.ministry || "";
        // A device's stored grant only wins inside the partition the typed password is
        // for: typing the 장년부 password on a 대학부 리더's phone must not hand back the
        // 대학부 scope (and vice versa). Mismatched partitions fall through to break-glass.
        if (partitionOfRole(group, ministry) === grant.partition) {
          return {
            memberId,
            role: row.role,
            group,
            subgroup: row.subgroup || "",
            ministry,
            partition: grant.partition,
          };
        }
      }
    }
  }
  // Break-glass: correct team password on a device with no linked admin role → the role the
  // password maps to, scoped to that password's partition. memberId is empty (no member to
  // attribute) — safe because every role.memberId lookup downstream is gated behind a
  // leader/welcoming/staff role check (super_admin paths key off role.role and audit via
  // the device id), and scopeFilter still pins the login to its own partition.
  return { memberId: "", role: grant.role, group: "", subgroup: "", ministry: "", partition: grant.partition };
}

// Verify via Supabase JWT (Google sign-in path). Resolves email → member → role.
export async function verifyAdminJwt(sb: SB, jwt: string): Promise<Role | null> {
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user?.email) return null;
  const { data: member } = await sb.from("members").select("id").ilike("email", user.email).single();
  const memberId = (member as { id?: string } | null)?.id;
  if (!memberId) return null;
  const { data: r } = await sb.from("member_roles").select("*").eq("member_id", memberId).single();
  if (!r) return null;
  const row = r as { role: AdminRole; group_name?: string; subgroup?: string; ministry?: string };
  const group = row.group_name || "", ministry = row.ministry || "";
  return {
    memberId,
    role: row.role,
    group,
    subgroup: row.subgroup || "",
    ministry,
    partition: partitionOfRole(group, ministry),
  };
}

// Unified resolver: try Google JWT first (Authorization: Bearer), fall back to
// device + master password. All hardened admin endpoints call this.
export async function resolveAdmin(sb: SB, req: Request): Promise<Role | null> {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return verifyAdminJwt(sb, auth.slice(7));
  const deviceId = req.headers.get("x-device-id") || req.headers.get("X-Device-Id") || "";
  return verifyAdmin(sb, deviceId, req.headers.get("x-admin-password") || "");
}
