// Admin auth + scope helpers for the hardened edge function (spec D1).
//
// Two auth paths, tried in order by resolveAdmin():
//   1. Google JWT (Bearer token): email → members.email → member_roles → role/scope.
//   2. Break-glass: the master password alone — works on ANY device, registered or not.
//      A device that happens to be linked to a roled member keeps that member's scope;
//      any other device gets full super_admin access.
// Public check-in stays anonymous and PII-free.
//
// Wired into index.ts (imports resolveAdmin + scopeFilter) and unit-tested (auth.test.ts).

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
//  MASTER ADMIN PASSWORD — change this one line when you need to rotate it (or set
//  a MASTER_PASSWORD env var to override without editing code). On its own it grants
//  admin access from ANY device, so treat it as a secret and rotate it if leaked.
export const MASTER_PASSWORD = Deno.env.get("MASTER_PASSWORD") ?? "kccpwelcome";
// ─────────────────────────────────────────────────────────────────────────────

export type AdminRole = "super_admin" | "leader" | "pastor" | "welcoming";

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
  if (role.role === "super_admin" || role.role === "pastor") return { all: true };
  if (role.role === "leader" || role.role === "welcoming") {
    const combined = role.group === "합동" ||
      (summerMode && (role.group === "대학부" || role.group === "청년부"));
    const groups = combined ? ["대학부", "청년부"] : [role.group].filter(Boolean);
    return { all: false, groups, subgroup: role.subgroup };
  }
  // any other scoped role
  return { all: false, groups: [role.group].filter(Boolean), subgroup: role.subgroup };
}

type SB = ReturnType<typeof createClient>;

// Verify an admin via the master password. The password is the break-glass credential:
// when it matches, access is granted from ANY device — no registration required and the
// device id is irrelevant (so staff can sign in from a phone, a borrowed laptop, a fresh
// browser, etc.). If the device happens to be a personal one linked to a member who holds
// a scoped role, that scope is preserved; otherwise full super_admin access is granted.
// Returns null only when the password is wrong.
export async function verifyAdmin(sb: SB, deviceId: string, password: string): Promise<Role | null> {
  if (password !== MASTER_PASSWORD) return null;
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
  // Break-glass: correct master password on a device with no linked admin role → full
  // super_admin. memberId is empty (no member to attribute) — safe because every
  // memberId lookup downstream is gated behind a non-super_admin role check.
  return { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "" };
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
