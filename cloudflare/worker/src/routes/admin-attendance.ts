// Manual/admin attendance mutations + clear-all workflow — ported from
// supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok, readBody } from "../lib/http";
import { resolveAdmin, scopeFilter } from "../lib/auth";
import { addAudit, getCfg, isDongsanLeaderName, localDate, localTime, updateCfg } from "../lib/helpers";
import { toJson } from "../lib/db";

const app = new Hono<{ Bindings: Env }>();

type MemberRow = { name: string; group_name: string; subgroup: string; member_role: string | null };

async function scopeCheck(db: D1Database, role: NonNullable<Awaited<ReturnType<typeof resolveAdmin>>>, m: MemberRow): Promise<boolean> {
  if (role.role === "super_admin") return true;
  const cfg = await getCfg(db);
  const scope = scopeFilter(role, cfg.summer_mode);
  if (scope.all) return true;
  if (!scope.groups.includes(m.group_name)) return false;
  if (scope.subgroup && m.subgroup !== scope.subgroup) return false;
  return true;
}

// Manual check-in (member-id based): mark a member present for today, bypassing
// day/time/location gating.
app.post("/member-checkin", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const memberId = String(body.memberId || "");
  if (!memberId) return fail(c, 400, "memberId required");
  const m = await db.prepare("SELECT name, group_name, subgroup, member_role FROM members WHERE id = ?").bind(memberId).first<MemberRow>();
  if (!m) return fail(c, 404, "Member not found");
  if (!(await scopeCheck(db, role, m))) return fail(c, 403, "Out of scope");

  const today = localDate();
  const time = localTime();
  const exist = await db.prepare("SELECT time_str FROM attendance_log WHERE member_id = ? AND date = ? LIMIT 1").bind(memberId, today).first<{ time_str: string }>();
  if (exist) return ok(c, { status: "already", time: exist.time_str, name: m.name });
  const count = await db.prepare("SELECT COUNT(*) AS n FROM attendance_log WHERE member_id = ?").bind(memberId).first<{ n: number }>();
  const isFirst = (count?.n || 0) === 0;
  const dev = await db.prepare("SELECT id FROM devices WHERE member_id = ? LIMIT 1").bind(memberId).first<{ id: string }>();
  const did = dev?.id || "MANUAL-" + Date.now();
  await db
    .prepare(
      "INSERT INTO attendance_log (device_id, member_id, name, group_name, subgroup, date, time_str, ts, is_manual, admin_added, first_visit, member_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)",
    )
    .bind(did, memberId, m.name, m.group_name || "", m.subgroup || "", today, time, Date.now(), isFirst ? 1 : 0, m.member_role || null)
    .run();
  await addAudit(db, "admin-checkin", c.req.header("x-device-id") || "", m.name + " | " + today);
  return ok(c, { status: "ok", time, name: m.name, firstVisit: isFirst });
});

// Manual attendance — add an entry for a member on ANY date (back-fill).
app.post("/log/add", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const memberId = String(body.memberId || "");
  const date = String(body.date || "");
  if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(c, 400, "memberId and a YYYY-MM-DD date required");
  const m = await db.prepare("SELECT name, group_name, subgroup, member_role FROM members WHERE id = ?").bind(memberId).first<MemberRow>();
  if (!m) return fail(c, 404, "Member not found");
  if (!(await scopeCheck(db, role, m))) return fail(c, 403, "Out of scope");
  const exist = await db.prepare("SELECT id FROM attendance_log WHERE member_id = ? AND date = ? LIMIT 1").bind(memberId, date).first();
  if (exist) return ok(c, { status: "already" });
  const dev = await db.prepare("SELECT id FROM devices WHERE member_id = ? LIMIT 1").bind(memberId).first<{ id: string }>();
  const did = dev?.id || "MANUAL-" + Date.now();
  await db
    .prepare(
      "INSERT INTO attendance_log (device_id, member_id, name, group_name, subgroup, date, time_str, ts, is_manual, admin_added, member_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)",
    )
    .bind(did, memberId, m.name, m.group_name || "", m.subgroup || "", date, localTime(), Date.now(), m.member_role || null)
    .run();
  await addAudit(db, "manual-add", c.req.header("x-device-id") || "", m.name + " | " + date);
  return ok(c, { status: "ok" });
});

// Manual attendance — remove a single entry by its row id.
app.post("/log/remove", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const logId = body.logId;
  if (logId === undefined || logId === null) return fail(c, 400, "logId required");
  const row = await db.prepare("SELECT id, name, date, member_id FROM attendance_log WHERE id = ?").bind(logId).first<{ id: number; name: string; date: string; member_id: string | null }>();
  if (!row) return fail(c, 404, "Entry not found");
  if (role.role !== "super_admin" && row.member_id) {
    const m = await db.prepare("SELECT group_name, subgroup FROM members WHERE id = ?").bind(row.member_id).first<{ group_name: string; subgroup: string }>();
    const cfg = await getCfg(db);
    const scope = scopeFilter(role, cfg.summer_mode);
    if (m && !scope.all) {
      if (!scope.groups.includes(m.group_name)) return fail(c, 403, "Out of scope");
      if (scope.subgroup && m.subgroup !== scope.subgroup) return fail(c, 403, "Out of scope");
    }
  }
  await db.prepare("DELETE FROM attendance_log WHERE id = ?").bind(logId).run();
  await addAudit(db, "manual-remove", c.req.header("x-device-id") || "", row.name + " | " + row.date);
  return ok(c, { status: "ok" });
});

// Bulk attendance — add an entry for many members on a chosen date.
app.post("/log/add-bulk", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const memberIds = body.memberIds;
  const date = String(body.date || "");
  if (!Array.isArray(memberIds) || !memberIds.length || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail(c, 400, "memberIds[] and a YYYY-MM-DD date required");
  }
  const placeholders = memberIds.map(() => "?").join(",");
  let scoped = (await db.prepare(`SELECT id, name, group_name, subgroup, member_role FROM members WHERE id IN (${placeholders})`).bind(...memberIds).all<{ id: string; name: string; group_name: string; subgroup: string; member_role: string | null }>()).results || [];
  if (role.role !== "super_admin") {
    const cfg = await getCfg(db);
    const scope = scopeFilter(role, cfg.summer_mode);
    if (!scope.all) scoped = scoped.filter((m) => scope.groups.includes(m.group_name) && (!scope.subgroup || m.subgroup === scope.subgroup));
  }
  if (!scoped.length) return ok(c, { status: "ok", added: 0 });
  const ids = scoped.map((m) => m.id);
  const idPh = ids.map(() => "?").join(",");
  const existing = (await db.prepare(`SELECT member_id FROM attendance_log WHERE member_id IN (${idPh}) AND date = ?`).bind(...ids, date).all<{ member_id: string }>()).results || [];
  const have = new Set(existing.map((e) => e.member_id));
  const toAdd = scoped.filter((m) => !have.has(m.id));
  if (toAdd.length) {
    const devs = (await db.prepare(`SELECT id, member_id FROM devices WHERE member_id IN (${idPh})`).bind(...ids).all<{ id: string; member_id: string }>()).results || [];
    const devByMember: Record<string, string> = {};
    for (const d of devs) if (!devByMember[d.member_id]) devByMember[d.member_id] = d.id;
    const now = Date.now();
    const time = localTime();
    const stmts = toAdd.map((m, i) =>
      db
        .prepare(
          "INSERT INTO attendance_log (device_id, member_id, name, group_name, subgroup, date, time_str, ts, is_manual, is_bulk, admin_added, member_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?)",
        )
        .bind(devByMember[m.id] || "MANUAL-" + (now + i), m.id, m.name, m.group_name || "", m.subgroup || "", date, time, now + i, m.member_role || null),
    );
    await db.batch(stmts);
  }
  await addAudit(db, "bulk-add", c.req.header("x-device-id") || "", date + " | " + toAdd.length + " members");
  return ok(c, { status: "ok", added: toAdd.length });
});

// Clear ALL attendance records. Super-admin clears immediately; a non-super admin
// (leader/welcoming who is NOT a 동산지기/부동산지기) files a request held for super approval.
app.post("/attendance/clear", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  const xDev = c.req.header("x-device-id") || "";
  if (role.role === "super_admin") {
    await db.prepare("DELETE FROM attendance_log").run();
    await addAudit(db, "clear-attendance", xDev, "모든 출석 기록 삭제");
    return ok(c, { status: "cleared" });
  }
  if (role.role !== "leader" && role.role !== "welcoming" && role.role !== "staff") return fail(c, 403, "Not authorized");
  const cfg = await getCfg(db);
  const me = await db.prepare("SELECT name FROM members WHERE id = ?").bind(role.memberId).first<{ name: string }>();
  if (isDongsanLeaderName(me?.name || "", role.group, role.subgroup, cfg.dongsan_leaders, cfg.summer_mode)) {
    return fail(c, 403, "동산지기/부동산지기는 사용할 수 없습니다");
  }
  const pending = cfg.pending_clear;
  pending.push({ requestedBy: xDev, requestedByName: me?.name || xDev, requestedAt: Date.now() });
  await updateCfg(db, { pending_clear: toJson(pending) });
  await addAudit(db, "clear-requested", xDev, "출석 기록 삭제 요청");
  return ok(c, { status: "pending" });
});

app.get("/attendance/clear-pending", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const cfg = await getCfg(c.env.DB);
  return ok(c, { pending: cfg.pending_clear });
});

app.post("/attendance/clear-approve", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  await db.prepare("DELETE FROM attendance_log").run();
  await updateCfg(db, { pending_clear: toJson([]) });
  await addAudit(db, "clear-attendance", c.req.header("x-device-id") || "", "모든 출석 기록 삭제 (요청 승인)");
  return ok(c, { status: "cleared" });
});

app.post("/attendance/clear-reject", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  await updateCfg(db, { pending_clear: toJson([]) });
  await addAudit(db, "clear-rejected", c.req.header("x-device-id") || "", "출석 기록 삭제 요청 거절");
  return ok(c, { status: "ok" });
});

// Kiosk guest (방문자) check-in — the kiosk runs on a verified admin device, so this is
// hardened and bypasses day/time/location. Deduped by name+date.
app.post("/guest-checkin", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const name = String(body.name || "").trim();
  if (!name) return fail(c, 400, "name required");
  const group = body.group === "대학부" || body.group === "청년부" ? String(body.group) : "";
  const today = localDate();
  const time = localTime();
  const exist = await db.prepare("SELECT time_str FROM attendance_log WHERE name = ? AND date = ? AND is_guest = 1 LIMIT 1").bind(name, today).first<{ time_str: string }>();
  if (exist) return ok(c, { status: "already", time: exist.time_str, name });
  await db
    .prepare("INSERT INTO attendance_log (device_id, name, group_name, subgroup, date, time_str, ts, is_manual, is_guest, member_role) VALUES (?, ?, ?, '', ?, ?, ?, 1, 1, 'visitor')")
    .bind("GUEST-" + Date.now(), name, group, today, time, Date.now())
    .run();
  await addAudit(db, "guest-checkin", c.req.header("x-device-id") || "", name + (group ? " | " + group : "") + " | " + today);
  return ok(c, { status: "ok", time, name });
});

// Kiosk 새가족 (new-family) registration — creates a member with is_new_member=true and
// the extended profile fields, links a NEW-{ts} device, then immediately records today's
// attendance (first_visit) unless body.skipCheckin (admin card-scan path).
app.post("/kiosk-new-member", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const name = String(body.name || "").trim();
  const group = String(body.group || "").trim();
  if (!name || !group) return fail(c, 400, "name and group required");
  const subgroup = String(body.subgroup || "").trim();
  const today = localDate();
  const time = localTime();
  const pastoralVisitRequested = body.pastoralVisitRequested === true ? 1 : body.pastoralVisitRequested === false ? 0 : null;
  const registrationDate = String(body.registrationDate || "").trim() || today;

  const created = await db
    .prepare(
      `INSERT INTO members (id, name, group_name, subgroup, is_new_member, gender, phone, kakao_id, birth_date, baptism_status, school_or_work, faith_duration, registration_date, pastoral_visit_requested)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      crypto.randomUUID(), name, group, subgroup,
      body.gender || "", body.phone || "", body.kakaoId || "",
      body.birthDate || null, body.baptismStatus || "해당없음",
      body.schoolOrWork || "", body.faithDuration || "", registrationDate, pastoralVisitRequested,
    )
    .first<{ id: string }>();
  const memberId = created?.id;
  if (!memberId) return fail(c, 500, "Could not create member");

  const newId = "NEW-" + Date.now();
  await db.prepare("INSERT INTO devices (id, name, group_name, subgroup, member_id, is_new_member) VALUES (?, ?, ?, ?, ?, 1)").bind(newId, name, group, subgroup, memberId).run();
  // skipCheckin (admin card-scan path): create the member + device but don't record
  // today's attendance — e.g. entering a stack of paper cards later in the week.
  if (!body.skipCheckin) {
    await db
      .prepare("INSERT INTO attendance_log (device_id, member_id, name, group_name, subgroup, date, time_str, ts, is_manual, admin_added, first_visit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1)")
      .bind(newId, memberId, name, group, subgroup, today, time, Date.now())
      .run();
  }
  await addAudit(db, "new-member-register", c.req.header("x-device-id") || "", name + " | " + group + (body.skipCheckin ? " | no-checkin" : ""));
  return ok(c, { status: "ok", memberId, time });
});

export default app;
