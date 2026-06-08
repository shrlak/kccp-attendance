// Admin auth + scope helpers for the hardened edge function (spec D1).
//
// Model: NO email / NO Supabase Auth. Admin access = a PERSONAL device (any id that
// is not a ROSTER-## seed stub) whose member holds a role in `member_roles`, gated by
// the shared master password below. Public check-in stays anonymous and PII-free.
//
// NOT YET WIRED INTO index.ts — that integration ships with the coordinated cutover
// (plan Phase F). Import-clean and unit-tested (auth.test.ts).

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
//  MASTER ADMIN PASSWORD — change this one line when you need to rotate it (or set
//  a MASTER_PASSWORD env var to override without editing code). Gates ALL admin
//  access, alongside a personal (non-ROSTER) device.
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

// Mirror of the legacy browser ACL: super/pastor see everything; a KM leader spans both
// 대학부·청년부 in summer mode (합동) but only their own 부서 in semester mode; the
// subgroup always pins to their 동산.
export function scopeFilter(role: Role, summerMode: boolean): Scope {
  if (role.role === "super_admin" || role.role === "pastor") return { all: true };
  if (role.role === "leader") {
    const groups = summerMode && (role.group === "대학부" || role.group === "청년부")
      ? ["대학부", "청년부"]
      : [role.group];
    return { all: false, groups, subgroup: role.subgroup };
  }
  // welcoming (새가족팀) and any other scoped role
  return { all: false, groups: [role.group].filter(Boolean), subgroup: role.subgroup };
}

type SB = ReturnType<typeof createClient>;

// Verify an admin: a personal (non-ROSTER) device whose member holds a role, AND the
// correct master password. Returns the role+scope, or null if any check fails.
export async function verifyAdmin(sb: SB, deviceId: string, password: string): Promise<Role | null> {
  if (!isPersonalDevice(deviceId)) return null;
  if (password !== MASTER_PASSWORD) return null;
  const { data: dev } = await sb.from("devices").select("member_id").eq("id", deviceId).single();
  const memberId = (dev as { member_id?: string } | null)?.member_id;
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
