// Staff auth + scope helpers for the hardened edge function (spec D1 / plan Phase C1).
//
// NOT YET WIRED INTO index.ts — that integration ships with the coordinated cutover
// (plan Phase F), because deploying a function that requires auth on /api/roster while
// the legacy app is live would break it. This module is import-clean and unit-tested
// (auth.test.ts) so it can be reviewed and validated on a Supabase branch first.

import { createClient } from "jsr:@supabase/supabase-js@2";

export interface Staff {
  userId: string;
  memberId?: string | null;
  role: "super_admin" | "leader" | "pastor" | "welcoming";
  group: string;
  subgroup: string;
  ministry: string;
}

export type Scope = { all: true } | { all: false; groups: string[]; subgroup: string };

// Mirror of the legacy browser ACL: super/pastor see everything; a KM leader spans both
// 대학부·청년부 in summer mode (합동) but only their own 부서 in semester mode; the
// subgroup always pins to their 동산.
export function scopeFilter(staff: Staff, summerMode: boolean): Scope {
  if (staff.role === "super_admin" || staff.role === "pastor") return { all: true };
  if (staff.role === "leader") {
    const groups = summerMode && (staff.group === "대학부" || staff.group === "청년부")
      ? ["대학부", "청년부"]
      : [staff.group];
    return { all: false, groups, subgroup: staff.subgroup };
  }
  // welcoming (새가족팀) and any other scoped role
  return { all: false, groups: [staff.group].filter(Boolean), subgroup: staff.subgroup };
}

// Verify a bearer JWT and load the caller's staff row. Returns null when the request
// is unauthenticated or the user is not staff. Uses a service-role client to read
// `staff` (which is itself RLS-protected).
export async function getStaff(authHeader: string | null): Promise<Staff | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7);
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: userRes } = await sb.auth.getUser(jwt);
  const uid = userRes?.user?.id;
  if (!uid) return null;
  const { data } = await sb.from("staff").select("*").eq("user_id", uid).single();
  if (!data) return null;
  return {
    userId: uid,
    memberId: data.member_id,
    role: data.role,
    group: data.group_name || "",
    subgroup: data.subgroup || "",
    ministry: data.ministry || "",
  };
}
