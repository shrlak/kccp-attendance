// Member edit/merge/delete + device register/link — ported from
// supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok, readBody } from "../lib/http";
import { resolveAdmin, scopeFilter } from "../lib/auth";
import { addAudit, getCfg, isDongsanLeaderName, supersedeRosterPlaceholders } from "../lib/helpers";

const app = new Hono<{ Bindings: Env }>();

async function inScope(db: D1Database, role: Awaited<ReturnType<typeof resolveAdmin>>, groupName: string, subgroup: string): Promise<boolean> {
  if (!role || role.role === "super_admin") return true;
  const cfg = await getCfg(db);
  const scope = scopeFilter(role, cfg.summer_mode);
  if (scope.all) return true;
  if (!scope.groups.includes(groupName)) return false;
  if (scope.subgroup && subgroup !== scope.subgroup) return false;
  return true;
}

// Edit a member. Pastor is read-only; a leader may only edit members in their own 동산.
// Renames propagate to the denormalized devices/attendance names.
app.put("/member", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const memberId = String(body.memberId || "");
  if (!memberId) return fail(c, 400, "memberId required");
  const m = await db.prepare("SELECT name, group_name, subgroup FROM members WHERE id = ?").bind(memberId).first<{ name: string; group_name: string; subgroup: string }>();
  if (!m) return fail(c, 404, "Member not found");
  if (!(await inScope(db, role, m.group_name, m.subgroup))) return fail(c, 403, "Out of scope");

  const COLS: Record<string, string> = {
    name: "name", group: "group_name", subgroup: "subgroup", notes: "notes", memberRole: "member_role",
    gender: "gender", phone: "phone", birthDate: "birth_date", baptismStatus: "baptism_status",
    schoolOrWork: "school_or_work", faithDuration: "faith_duration", registrationDate: "registration_date",
    pastoralVisitRequested: "pastoral_visit_requested", isNewMember: "is_new_member",
    newMemberEduWeek1: "new_member_edu_week1", newMemberEduWeek2: "new_member_edu_week2", kakaoId: "kakao_id",
    statusNote: "status_note", statusStart: "status_start", statusEnd: "status_end",
  };
  const DATE_COLS = new Set(["birth_date", "registration_date", "status_start", "status_end"]);
  const BOOL_COLS = new Set(["pastoral_visit_requested", "is_new_member", "new_member_edu_week1", "new_member_edu_week2"]);
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, col] of Object.entries(COLS)) {
    if (body[k] === undefined) continue;
    sets.push(`${col} = ?`);
    if (DATE_COLS.has(col)) binds.push(body[k] || null);
    else if (BOOL_COLS.has(col)) binds.push(body[k] ? 1 : 0);
    else binds.push(body[k]);
  }
  if (sets.length) {
    await db.prepare(`UPDATE members SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...binds, memberId).run();
  }
  if (body.name !== undefined && body.name !== m.name) {
    await db.prepare("UPDATE devices SET name = ? WHERE member_id = ?").bind(body.name, memberId).run();
    await db.prepare("UPDATE attendance_log SET name = ? WHERE member_id = ?").bind(body.name, memberId).run();
  }
  await addAudit(db, "member-edit", c.req.header("x-device-id") || "", (body.name || m.name) + " (" + memberId + ")");
  return ok(c, { status: "ok" });
});

// Merge two members: reassign the source's devices + attendance into the target
// (inheriting the target's name/group/동산), then delete the source member.
app.post("/merge", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const fromId = String(body.fromId || "");
  const toId = String(body.toId || "");
  if (!fromId || !toId || fromId === toId) return fail(c, 400, "fromId and a different toId required");
  const from = await db.prepare("SELECT name, group_name, subgroup FROM members WHERE id = ?").bind(fromId).first<{ name: string; group_name: string; subgroup: string }>();
  const to = await db.prepare("SELECT name, group_name, subgroup FROM members WHERE id = ?").bind(toId).first<{ name: string; group_name: string; subgroup: string }>();
  if (!from || !to) return fail(c, 404, "Member not found");
  if (!(await inScope(db, role, from.group_name, from.subgroup)) || !(await inScope(db, role, to.group_name, to.subgroup))) {
    return fail(c, 403, "Out of scope");
  }
  // Reassign BEFORE deleting (devices.member_id is ON DELETE CASCADE). Migrated rows
  // inherit the target's denormalized name/group/동산.
  await db.prepare("UPDATE devices SET member_id = ?, name = ?, group_name = ?, subgroup = ? WHERE member_id = ?").bind(toId, to.name, to.group_name || "", to.subgroup || "", fromId).run();
  await db.prepare("UPDATE attendance_log SET member_id = ?, name = ?, group_name = ?, subgroup = ? WHERE member_id = ?").bind(toId, to.name, to.group_name || "", to.subgroup || "", fromId).run();
  await db.prepare("DELETE FROM members WHERE id = ?").bind(fromId).run();
  await addAudit(db, "member-merge", c.req.header("x-device-id") || "", from.name + " → " + to.name);
  return ok(c, { status: "ok" });
});

// Delete a member entirely: removes their attendance rows + the member (devices and
// member_roles cascade via FK). Irreversible.
app.post("/member/delete", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const memberId = String(body.memberId || "");
  if (!memberId) return fail(c, 400, "memberId required");
  const m = await db.prepare("SELECT name, group_name, subgroup FROM members WHERE id = ?").bind(memberId).first<{ name: string; group_name: string; subgroup: string }>();
  if (!m) return fail(c, 404, "Member not found");
  if (!(await inScope(db, role, m.group_name, m.subgroup))) return fail(c, 403, "Out of scope");
  // attendance_log.member_id is ON DELETE SET NULL, so the member's rows would orphan
  // (and keep counting) — delete them explicitly. devices + member_roles cascade.
  await db.prepare("DELETE FROM attendance_log WHERE member_id = ?").bind(memberId).run();
  await db.prepare("DELETE FROM members WHERE id = ?").bind(memberId).run();
  await addAudit(db, "member-delete", c.req.header("x-device-id") || "", m.name + " (" + memberId + ")");
  return ok(c, { status: "ok" });
});

// Bulk 동산 (subgroup) reassignment: set or clear the 동산 for many members at once.
// Allowed for super-admin OR a leader who is NOT a 동산지기/부동산지기.
app.post("/members/bulk-subgroup", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  const cfg = await getCfg(db);
  if (role.role !== "super_admin" && role.role !== "staff") {
    if (role.role !== "leader") return fail(c, 403, "Not authorized");
    const me = await db.prepare("SELECT name FROM members WHERE id = ?").bind(role.memberId).first<{ name: string }>();
    if (isDongsanLeaderName(me?.name || "", role.group, role.subgroup, cfg.dongsan_leaders, cfg.summer_mode)) {
      return fail(c, 403, "동산지기/부동산지기는 사용할 수 없습니다");
    }
  }
  const body = await readBody(c);
  const memberIds = body.memberIds;
  if (!Array.isArray(memberIds) || !memberIds.length) return fail(c, 400, "memberIds required");
  const sub = String(body.subgroup || "").trim();

  let targetIds: string[] = memberIds;
  if (role.role !== "super_admin") {
    const scope = scopeFilter(role, cfg.summer_mode);
    if (!scope.all) {
      const placeholders = memberIds.map(() => "?").join(",");
      const ms = (await db.prepare(`SELECT id, group_name, subgroup FROM members WHERE id IN (${placeholders})`).bind(...memberIds).all<{ id: string; group_name: string; subgroup: string }>()).results || [];
      targetIds = ms.filter((m) => scope.groups.includes(m.group_name) && (!scope.subgroup || m.subgroup === scope.subgroup)).map((m) => m.id);
    }
  }
  if (!targetIds.length) return ok(c, { status: "ok", updated: 0 });
  const placeholders = targetIds.map(() => "?").join(",");
  await db.prepare(`UPDATE members SET subgroup = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).bind(sub, ...targetIds).run();
  await db.prepare(`UPDATE devices SET subgroup = ? WHERE member_id IN (${placeholders})`).bind(sub, ...targetIds).run();
  await db.prepare(`UPDATE attendance_log SET subgroup = ? WHERE member_id IN (${placeholders})`).bind(sub, ...targetIds).run();
  await addAudit(db, "bulk-transfer", c.req.header("x-device-id") || "", targetIds.length + "명 → 동산 " + (sub || "(해제)"));
  return ok(c, { status: "ok", updated: targetIds.length });
});

// Register a device: find-or-create the member by name, then upsert a devices row
// linked to that member with the denormalized name/group/동산.
app.post("/device/register", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const did = String(body.deviceId || "").trim();
  const nm = String(body.name || "").trim();
  if (!did || !nm) return fail(c, 400, "deviceId and name required");
  const grp = String(body.group || "").trim();
  const sub = String(body.subgroup || "").trim();

  const mm = await db.prepare("SELECT id FROM members WHERE name = ? LIMIT 1").bind(nm).first<{ id: string }>();
  let memberId = mm?.id || null;
  if (!memberId) {
    const created = await db.prepare("INSERT INTO members (id, name, group_name, subgroup) VALUES (?, ?, ?, ?) RETURNING id").bind(crypto.randomUUID(), nm, grp, sub).first<{ id: string }>();
    memberId = created?.id || null;
  }
  await db
    .prepare(
      `INSERT INTO devices (id, name, group_name, subgroup, member_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, group_name=excluded.group_name, subgroup=excluded.subgroup, member_id=excluded.member_id`,
    )
    .bind(did, nm, grp, sub, memberId)
    .run();
  await supersedeRosterPlaceholders(db, nm, did);
  await addAudit(db, "device-register", c.req.header("x-device-id") || "", nm + " (" + did + ")");
  return ok(c, { status: "ok" });
});

// Link a device to an existing member: point an existing-or-new device id at the
// chosen member, inheriting that member's denormalized name/group/동산.
app.post("/device/link", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const did = String(body.deviceId || "").trim();
  const memberId = String(body.memberId || "");
  if (!did || !memberId) return fail(c, 400, "deviceId and memberId required");
  const m = await db.prepare("SELECT name, group_name, subgroup FROM members WHERE id = ?").bind(memberId).first<{ name: string; group_name: string; subgroup: string }>();
  if (!m) return fail(c, 404, "Member not found");
  if (!(await inScope(db, role, m.group_name, m.subgroup))) return fail(c, 403, "Out of scope");
  await db
    .prepare(
      `INSERT INTO devices (id, name, group_name, subgroup, member_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, group_name=excluded.group_name, subgroup=excluded.subgroup, member_id=excluded.member_id`,
    )
    .bind(did, m.name, m.group_name || "", m.subgroup || "", memberId)
    .run();
  await supersedeRosterPlaceholders(db, m.name, did);
  await addAudit(db, "device-edit", c.req.header("x-device-id") || "", m.name + " (" + did + ")");
  return ok(c, { status: "ok" });
});

export default app;
