// Public (unauthenticated) routes — ported from supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok, readBody } from "../lib/http";
import { checkLocation } from "../lib/geo";
import { checkedToday, countAtt, getCfg, localDate, localTime, fmtMin, supersedeRosterPlaceholders } from "../lib/helpers";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => ok(c, { status: "ok", ts: Date.now() }));

app.get("/config", async (c) => {
  const cfg = await getCfg(c.env.DB);
  return ok(c, {
    announcement: cfg.announcement,
    checkinDays: cfg.checkin_days,
    checkinStartMin: cfg.checkin_start_min,
    checkinEndMin: cfg.checkin_end_min,
    requireApproval: cfg.require_approval,
    summerMode: cfg.summer_mode,
    demoMode: cfg.demo_mode,
    individualCheckinEnabled: cfg.individual_checkin_enabled,
    groupColors: cfg.group_colors,
  });
});

app.post("/checkin", async (c) => {
  const db = c.env.DB;
  const body = await readBody(c);
  const deviceId = String(body.deviceId || "");
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;
  const cfg = await getCfg(db);
  const device = await db.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first<Record<string, unknown>>();

  if (!cfg.demo_mode) {
    const now = new Date();
    const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = eastern.getDay();
    const timeInMin = eastern.getHours() * 60 + eastern.getMinutes();
    const DAY = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
    if (!cfg.checkin_days.includes(day)) {
      return ok(c, {
        status: "time-restricted",
        message: "출석 가능한 요일이 아닙니다",
        sub: "출석 가능 요일: " + cfg.checkin_days.map((d) => DAY[d]).join(", "),
      });
    }
    if (timeInMin < cfg.checkin_start_min || timeInMin >= cfg.checkin_end_min) {
      return ok(c, {
        status: "time-restricted",
        message: "출석 시간이 아닙니다",
        sub: "출석 가능 시간: " + fmtMin(cfg.checkin_start_min) + " ~ " + fmtMin(cfg.checkin_end_min),
      });
    }
    const loc = checkLocation(lat, lng);
    if (loc === "required") return ok(c, { status: "location-required", message: "위치 정보가 필요합니다. 위치 접근을 허용해주세요." });
    if (loc !== null) return ok(c, { status: "location-restricted", message: "교회 근처에서만 출석할 수 있습니다.", distance: loc });
  }

  const today = localDate();
  const time = localTime();
  const ts = Date.now();
  const name = device?.name as string | undefined;
  const group = (device?.group_name as string) || "";
  const subgroup = (device?.subgroup as string) || "";
  const memberRole = (device?.member_role as string) || "";

  if (name) {
    const ex = await checkedToday(db, name, today);
    if (ex) {
      const total = await countAtt(db, name);
      return ok(c, { status: "already", time: ex.time_str, name, group, subgroup, totalAttendance: total });
    }
  } else {
    const ex = await db.prepare("SELECT * FROM attendance_log WHERE device_id = ? AND date = ? LIMIT 1").bind(deviceId, today).first<Record<string, unknown>>();
    if (ex) return ok(c, { status: "already", time: ex.time_str, name: ex.name, group: "", subgroup: "", totalAttendance: 0 });
  }

  const totalCount = name ? await countAtt(db, name) : 0;
  const isFirst = totalCount === 0;
  const dname = name || "Unknown (" + deviceId.slice(0, 12) + "...)";
  await db
    .prepare(
      "INSERT INTO attendance_log (device_id, name, group_name, subgroup, date, time_str, ts, location_verified, first_visit, member_role) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    )
    .bind(deviceId, dname, group, subgroup, today, time, ts, isFirst ? 1 : 0, memberRole || null)
    .run();

  return ok(c, { status: "ok", time, name: dname, group, subgroup, isRegistered: !!name, totalAttendance: totalCount + 1, firstVisit: isFirst });
});

app.post("/self-register", async (c) => {
  const db = c.env.DB;
  const body = await readBody(c);
  const deviceId = String(body.deviceId || "");
  const name = String(body.name || "");
  if (!deviceId || !name) return fail(c, 400, "deviceId and name required");
  const cleanName = name.trim();

  const ex = await db.prepare("SELECT id, name FROM devices WHERE id = ?").bind(deviceId).first<{ id: string; name: string }>();
  if (ex) return ok(c, { status: "already-registered", name: ex.name });

  // If a person with this name already exists, this device is being added for access
  // purposes — combine it with the existing record instead of creating a divergent
  // duplicate, and never flag it as 새가족.
  const match = await db
    .prepare("SELECT group_name, subgroup FROM devices WHERE name = ? LIMIT 1")
    .bind(cleanName)
    .first<{ group_name: string; subgroup: string }>();
  const finalGroup = match ? match.group_name || "" : String(body.group || "");
  const finalSub = match ? match.subgroup || "" : String(body.subgroup || "");

  const cfg = await getCfg(db);
  if (cfg.require_approval) {
    const already = await db.prepare("SELECT id FROM pending_registrations WHERE device_id = ?").bind(deviceId).first();
    if (!already) {
      await db
        .prepare("INSERT INTO pending_registrations (device_id, name, group_name, subgroup) VALUES (?, ?, ?, ?)")
        .bind(deviceId, cleanName, finalGroup, finalSub)
        .run();
    }
    return ok(c, { status: "pending", name: cleanName });
  }

  // Link this device to the person's existing member (a linked device's member, else the
  // members row by name) so a returning admin's personal device inherits their member.
  let memberId: string | null = null;
  const linked = await db
    .prepare("SELECT member_id FROM devices WHERE name = ? AND member_id IS NOT NULL LIMIT 1")
    .bind(cleanName)
    .first<{ member_id: string }>();
  if (linked) memberId = linked.member_id;
  else {
    const mm = await db.prepare("SELECT id FROM members WHERE name = ? LIMIT 1").bind(cleanName).first<{ id: string }>();
    if (mm) memberId = mm.id;
  }

  await db
    .prepare(
      `INSERT INTO devices (id, name, group_name, subgroup, is_new_member, member_id) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, group_name=excluded.group_name, subgroup=excluded.subgroup, is_new_member=excluded.is_new_member, member_id=excluded.member_id`,
    )
    .bind(deviceId, cleanName, finalGroup, finalSub, memberId)
    .run();
  await db
    .prepare("UPDATE attendance_log SET name = ?, group_name = ?, subgroup = ? WHERE device_id = ?")
    .bind(cleanName, finalGroup, finalSub, deviceId)
    .run();
  await supersedeRosterPlaceholders(db, cleanName, deviceId);

  return ok(c, { status: "ok", name: cleanName, combined: !!match });
});

export default app;
