// GET /api/roster — ported from supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok } from "../lib/http";
import { resolveAdmin, scopeFilter } from "../lib/auth";
import { getCfg, isDongsanLeaderName, rowToLog } from "../lib/helpers";

const app = new Hono<{ Bindings: Env }>();

app.get("/roster", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  const cfg = await getCfg(db);
  const scope = scopeFilter(role, cfg.summer_mode);

  let members: Record<string, unknown>[];
  if (scope.all) {
    members = (await db.prepare("SELECT * FROM members ORDER BY name ASC").all<Record<string, unknown>>()).results || [];
  } else if (scope.subgroup) {
    const placeholders = scope.groups.map(() => "?").join(",");
    members =
      (
        await db
          .prepare(`SELECT * FROM members WHERE group_name IN (${placeholders}) AND subgroup = ? ORDER BY name ASC`)
          .bind(...scope.groups, scope.subgroup)
          .all<Record<string, unknown>>()
      ).results || [];
  } else {
    const placeholders = scope.groups.map(() => "?").join(",");
    members =
      (
        await db.prepare(`SELECT * FROM members WHERE group_name IN (${placeholders}) ORDER BY name ASC`).bind(...scope.groups).all<Record<string, unknown>>()
      ).results || [];
  }

  const ids = members.map((m) => m.id as string);
  let logs: Record<string, unknown>[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    logs =
      (
        await db
          .prepare(`SELECT * FROM attendance_log WHERE member_id IN (${placeholders}) ORDER BY ts DESC`)
          .bind(...ids)
          .all<Record<string, unknown>>()
      ).results || [];
  }
  // 방문자(guests) have no member_id and no 부서/동산, so the member-id filter above drops
  // them. Fold them in for unscoped admins (super/pastor) so they appear in the 오늘 tab;
  // scoped leaders keep just their 동산 (guests aren't theirs).
  if (scope.all) {
    const gd = (await db.prepare("SELECT * FROM attendance_log WHERE is_guest = 1 ORDER BY ts DESC").all<Record<string, unknown>>()).results || [];
    if (gd.length) logs = logs.concat(gd);
  }

  // Bulk 동산 reassignment: super-admins + staff + leaders who are NOT 동산지기/부동산지기.
  // Clear-all-attendance: super (direct) + staff/leader/welcoming non-동산지기 (request).
  let canBulkSubgroup = role.role === "super_admin" || role.role === "staff";
  let canClearAttendance = role.role === "super_admin" || role.role === "staff";
  if (role.role === "leader" || role.role === "welcoming") {
    const me = await db.prepare("SELECT name FROM members WHERE id = ?").bind(role.memberId).first<{ name: string }>();
    const tag = isDongsanLeaderName(me?.name || "", role.group, role.subgroup, cfg.dongsan_leaders, cfg.summer_mode);
    if (role.role === "leader") canBulkSubgroup = !tag;
    canClearAttendance = !tag;
  }

  return ok(c, { role: role.role, canBulkSubgroup, canClearAttendance, members, log: logs.map(rowToLog) });
});

export default app;
