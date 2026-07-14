// Admin auth + scope helpers — ported from supabase/functions/attendance-api/auth.ts.
//
// Two auth paths, tried in order by resolveAdmin():
//   1. Google JWT (Bearer token): verified against Supabase Auth's REST endpoint (the one
//      intentional remaining Supabase dependency — see cloudflare/README.md), then
//      email -> members.email -> member_roles -> role/scope, all queried from D1.
//   2. Break-glass: a shared team password alone — works on ANY device, registered or not.
//      There are three passwords, each landing on a different dashboard:
//        - SUPER_PASSWORD      -> "super_admin" role (full panel: settings, admins, backup…)
//        - LEADER_PASSWORD     -> "leader"      role (리더 dashboard)
//        - WELCOMING_PASSWORD  -> "welcoming"   role (새가족팀 dashboard)
//      A device that happens to be linked to a roled member keeps that member's scope;
//      otherwise the login gets the password's break-glass role. All three see the whole
//      roster (a shared password can't pin to one 동산); only SUPER_PASSWORD grants the
//      super_admin powers (settings, admin management, 동산지기/임원, backup).
// Public check-in stays anonymous and PII-free.

import type { Env } from "../types";

// Roles. "staff" is a legacy combined 리더+새가족팀 break-glass role (no longer minted by
// the password path, which now grants "leader"/"welcoming" directly — kept for back-compat
// with any pre-existing member_roles row using it).
export type AdminRole = "super_admin" | "leader" | "pastor" | "welcoming" | "staff";

export interface Role {
  memberId: string;
  role: AdminRole;
  group: string;
  subgroup: string;
  ministry: string;
}

export type Scope = { all: true } | { all: false; groups: string[]; subgroup: string };

function passwords(env: Env) {
  return {
    SUPER: env.SUPER_PASSWORD ?? "kccpadmin",
    LEADER: env.LEADER_PASSWORD ?? "kccpleaders",
    WELCOMING: env.WELCOMING_PASSWORD ?? "kccpwelcome",
  };
}

// Map a typed password to the break-glass role it grants, or null if it matches none.
// Checked super -> leader -> welcoming so the higher-privilege match wins if two passwords
// are (mis)configured identically.
export function passwordRole(password: string, env: Env): "super_admin" | "leader" | "welcoming" | null {
  if (!password) return null;
  const pw = passwords(env);
  if (password === pw.SUPER) return "super_admin";
  if (password === pw.LEADER) return "leader";
  if (password === pw.WELCOMING) return "welcoming";
  return null;
}

// Any device id that is NOT a ROSTER-## seed stub is a real personal device. Admin
// roles may only ever attach to personal devices — never to ROSTER placeholders.
export function isPersonalDevice(deviceId: string): boolean {
  return !!deviceId && !deviceId.startsWith("ROSTER-");
}

// Mirror of the legacy browser ACL: super/pastor see everything; a leader or 새가족팀
// (welcoming) member is scoped to their 부서 + 동산. A "합동" group spans BOTH 대학부·
// 청년부 in EVERY season (the shared 임원 account); in summer mode a 대학부/청년부 scope
// is likewise promoted to 합동.
export function scopeFilter(role: Role, summerMode: boolean): Scope {
  if (role.role === "super_admin" || role.role === "pastor" || role.role === "staff") return { all: true };
  if ((role.role === "leader" || role.role === "welcoming") && !role.memberId) return { all: true };
  if (role.role === "leader" || role.role === "welcoming") {
    const combined =
      role.group === "합동" || (summerMode && (role.group === "대학부" || role.group === "청년부"));
    const groups = combined ? ["대학부", "청년부"] : [role.group].filter(Boolean);
    return { all: false, groups, subgroup: role.subgroup };
  }
  return { all: false, groups: [role.group].filter(Boolean), subgroup: role.subgroup };
}

type RoleRow = { role: AdminRole; group_name: string | null; subgroup: string | null; ministry: string | null };

// Verify an admin via a shared team password. Either break-glass password grants access
// from ANY device. If the device happens to be a personal one linked to a member who
// holds a scoped role, that member's scope is preserved; otherwise the login gets the
// role the password maps to, all with full-roster visibility.
export async function verifyAdmin(db: D1Database, deviceId: string, password: string, env: Env): Promise<Role | null> {
  const bgRole = passwordRole(password, env);
  if (!bgRole) return null;
  if (isPersonalDevice(deviceId)) {
    const dev = await db.prepare("SELECT member_id FROM devices WHERE id = ?").bind(deviceId).first<{ member_id: string | null }>();
    const memberId = dev?.member_id;
    if (memberId) {
      const r = await db.prepare("SELECT role, group_name, subgroup, ministry FROM member_roles WHERE member_id = ?").bind(memberId).first<RoleRow>();
      if (r) {
        return { memberId, role: r.role, group: r.group_name || "", subgroup: r.subgroup || "", ministry: r.ministry || "" };
      }
    }
  }
  return { memberId: "", role: bgRole, group: "", subgroup: "", ministry: "" };
}

// Verify via a Google-signed Supabase Auth JWT: resolve it to an email through Supabase
// Auth's REST endpoint (a plain fetch — no SDK), then email -> member -> role, all in D1.
export async function verifyAdminJwt(db: D1Database, jwt: string, env: Env): Promise<Role | null> {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!resp.ok) return null;
  const user = (await resp.json().catch(() => null)) as { email?: string } | null;
  if (!user?.email) return null;
  const member = await db.prepare("SELECT id FROM members WHERE lower(email) = lower(?)").bind(user.email).first<{ id: string }>();
  if (!member?.id) return null;
  const r = await db.prepare("SELECT role, group_name, subgroup, ministry FROM member_roles WHERE member_id = ?").bind(member.id).first<RoleRow>();
  if (!r) return null;
  return { memberId: member.id, role: r.role, group: r.group_name || "", subgroup: r.subgroup || "", ministry: r.ministry || "" };
}

// Unified resolver: try Google JWT first (Authorization: Bearer), fall back to
// device + shared password. All hardened admin endpoints call this.
export async function resolveAdmin(db: D1Database, req: Request, env: Env): Promise<Role | null> {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return verifyAdminJwt(db, auth.slice(7), env);
  const deviceId = req.headers.get("x-device-id") || "";
  return verifyAdmin(db, deviceId, req.headers.get("x-admin-password") || "", env);
}
