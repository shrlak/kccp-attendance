// Admin auth + scope helpers for the hardened edge function (spec D1).
//
// Two auth paths, tried in order by resolveAdmin():
//   1. Google JWT (Bearer token): email → members.email → member_roles → role/scope.
//   2. Break-glass: a shared team password alone — works on ANY device, registered or not.
//      There are three passwords, each landing on a different dashboard:
//        • SUPER_PASSWORD      → "super_admin" role (full panel: settings, admins, backup…)
//        • LEADER_PASSWORD     → "leader"      role (리더 dashboard)
//        • WELCOMING_PASSWORD  → "welcoming"   role (새가족팀 dashboard)
//      A device that happens to be linked to a roled member keeps that member's scope;
//      otherwise the login gets the password's break-glass role. All three see the whole
//      roster (a shared password can't pin to one 동산); only SUPER_PASSWORD grants the
//      super_admin powers (settings, admin management, 동산지기/임원, backup).
// Public check-in stays anonymous and PII-free.
//
// Wired into index.ts (imports resolveAdmin + scopeFilter) and unit-tested (auth.test.ts).

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
//  SHARED TEAM PASSWORDS — change these lines to rotate them (or set the matching env
//  vars to override without editing code). Each grants admin access from ANY device and
//  lands on its own dashboard, so treat them as secrets and rotate if leaked:
//    • SUPER_PASSWORD     → the full super-admin panel
//    • LEADER_PASSWORD    → the 리더(leader) dashboard
//    • WELCOMING_PASSWORD → the 새가족팀(welcoming) dashboard
export const SUPER_PASSWORD = Deno.env.get("SUPER_PASSWORD") ?? "kccpadmin";
export const LEADER_PASSWORD = Deno.env.get("LEADER_PASSWORD") ?? "kccpleaders";
export const WELCOMING_PASSWORD =
  Deno.env.get("WELCOMING_PASSWORD") ?? Deno.env.get("MASTER_PASSWORD") ?? "kccpwelcome";
// Backwards-compat alias for the legacy single break-glass credential (now the welcoming
// password). Kept so older references / env overrides keep working.
export const MASTER_PASSWORD = WELCOMING_PASSWORD;
// ─────────────────────────────────────────────────────────────────────────────

// Map a typed password to the break-glass role it grants, or null if it matches none.
// Checked super → leader → welcoming so the higher-privilege match wins if two passwords
// are (mis)configured identically.
export function passwordRole(password: string): "super_admin" | "leader" | "welcoming" | null {
  if (!password) return null;
  if (password === SUPER_PASSWORD) return "super_admin";
  if (password === LEADER_PASSWORD) return "leader";
  if (password === WELCOMING_PASSWORD) return "welcoming";
  return null;
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
}

export type Scope = { all: true } | { all: false; groups: string[]; subgroup: string };

// Any device id that is NOT a ROSTER-## seed stub is a real personal device. Admin
// roles may only ever attach to personal devices — never to ROSTER placeholders.
export function isPersonalDevice(deviceId: string): boolean {
  return !!deviceId && !deviceId.startsWith("ROSTER-");
}

// Mirror of the legacy browser ACL: super/pastor see everything; a leader or 새가족팀
// (welcoming) member is scoped to their 부서 + 동산. A "합동" group spans BOTH 대학부·
// 청년부 in EVERY season (the shared 임원 account); in summer mode a 대학부/청년부 scope
// is likewise promoted to 합동 — so during 여름동산 a 새가족팀원 sees both 부서, while in
// 봄/가을동산 a 대학부 새가족팀원 sees only 대학부 and a 청년부 새가족팀원 only 청년부.
// The subgroup always pins to their 동산.
export function scopeFilter(role: Role, summerMode: boolean): Scope {
  // super/pastor see everything; staff (legacy break-glass) also sees the whole roster.
  if (role.role === "super_admin" || role.role === "pastor" || role.role === "staff") return { all: true };
  // Password-only (break-glass) leader/welcoming logins have no linked member (memberId="")
  // to scope to, so they see the whole roster — a shared team password can't pin to one
  // person's 부서/동산. Real roled leaders/welcoming members always carry a memberId.
  if ((role.role === "leader" || role.role === "welcoming") && !role.memberId) return { all: true };
  if (role.role === "leader" || role.role === "welcoming") {
    const combined = role.group === "합동" ||
      (summerMode && (role.group === "대학부" || role.group === "청년부"));
    const groups = combined ? ["대학부", "청년부"] : [role.group].filter(Boolean);
    return { all: false, groups, subgroup: role.subgroup };
  }
  // any other scoped role
  return { all: false, groups: [role.group].filter(Boolean), subgroup: role.subgroup };
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

// Verify an admin via a shared team password. Either break-glass password grants access
// from ANY device — no registration required and the device id is irrelevant (so staff can
// sign in from a phone, a borrowed laptop, a fresh browser, etc.). If the device happens to
// be a personal one linked to a member who holds a scoped role, that member's scope is
// preserved; otherwise the login gets the role the password maps to (SUPER_PASSWORD →
// "super_admin", LEADER_PASSWORD → "leader", WELCOMING_PASSWORD → "welcoming"), all with
// full-roster visibility. Returns null only when the password matches none of the three.
export async function verifyAdmin(sb: SB, deviceId: string, password: string): Promise<Role | null> {
  const bgRole = passwordRole(password);
  if (!bgRole) return null;
  if (isPersonalDevice(deviceId)) {
    const { data: dev } = await sb.from("devices").select("member_id").eq("id", deviceId).single();
    const memberId = (dev as { member_id?: string } | null)?.member_id;
    if (memberId) {
      const { data: r } = await sb.from("member_roles").select("*").eq("member_id", memberId).single();
      if (r) {
        const row = r as { role: AdminRole; group_name?: string; subgroup?: string; ministry?: string };
        return {
          memberId,
          role: row.role,
          group: row.group_name || "",
          subgroup: row.subgroup || "",
          ministry: row.ministry || "",
        };
      }
    }
  }
  // Break-glass: correct team password on a device with no linked admin role → the role the
  // password maps to ("super_admin", "leader", or "welcoming"), all-roster. memberId is
  // empty (no member to attribute) — safe because every role.memberId lookup downstream is
  // gated behind a leader/welcoming/staff role check (super_admin paths key off role.role
  // and audit via the device id), and super_admin / empty-memberId leader/welcoming are all
  // all-access in scopeFilter so scope checks never filter them.
  return { memberId: "", role: bgRole, group: "", subgroup: "", ministry: "" };
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
  return {
    memberId,
    role: row.role,
    group: row.group_name || "",
    subgroup: row.subgroup || "",
    ministry: row.ministry || "",
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
