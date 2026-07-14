// Shared, non-auth helpers — ported from supabase/functions/attendance-api/index.ts,
// translated from supabase-js query-builder calls to D1 prepared statements.

import { fromJson, toBool, toJson } from "./db";

export function localDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
export function localTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mn = m % 60;
  const h12 = h % 12 || 12;
  return String(h12).padStart(2, "0") + ":" + String(mn).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM");
}

export interface Cfg {
  checkin_days: number[];
  checkin_start_min: number;
  checkin_end_min: number;
  dongsan_names: Record<string, string[]>;
  dongsan_leaders: Record<string, Record<string, { leader?: string; subLeaders?: string[] }>>;
  officers: string[];
  require_approval: boolean;
  announcement: string;
  summer_mode: boolean;
  demo_mode: boolean;
  individual_checkin_enabled: boolean;
  pending_clear: { requestedBy: string; requestedByName: string; requestedAt: number }[];
  group_colors: Record<string, string>;
}

const DEFAULT_DONGSAN_NAMES = { "대학부": ["동산1", "동산2", "동산3", "동산4"], "청년부": ["동산1", "동산2", "동산3", "동산4"] };
const DEFAULT_GROUP_COLORS = { "대학부": "#E0A800", "청년부": "#3B82F6" };

export async function getCfg(db: D1Database): Promise<Cfg> {
  const row = await db.prepare("SELECT * FROM config WHERE id = 1").first<Record<string, unknown>>();
  return {
    checkin_days: fromJson(row?.checkin_days, [0]),
    checkin_start_min: (row?.checkin_start_min as number) ?? 780,
    checkin_end_min: (row?.checkin_end_min as number) ?? 900,
    dongsan_names: fromJson(row?.dongsan_names, DEFAULT_DONGSAN_NAMES),
    dongsan_leaders: fromJson(row?.dongsan_leaders, {}),
    officers: fromJson(row?.officers, []),
    require_approval: toBool(row?.require_approval),
    announcement: (row?.announcement as string) || "",
    summer_mode: toBool(row?.summer_mode),
    demo_mode: toBool(row?.demo_mode),
    individual_checkin_enabled: toBool(row?.individual_checkin_enabled),
    pending_clear: fromJson(row?.pending_clear, []),
    group_colors: fromJson(row?.group_colors, DEFAULT_GROUP_COLORS),
  };
}

// Partial UPDATE config SET ... WHERE id=1 — values must already be D1-storable
// (string/number/0-1 int); JSON columns should be pre-serialized with toJson().
export async function updateCfg(db: D1Database, patch: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const sql = `UPDATE config SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = 1`;
  await db.prepare(sql).bind(...cols.map((c) => patch[c])).run();
}

export function rowToDev(d: Record<string, unknown>) {
  return {
    name: d.name,
    group: d.group_name || "",
    subgroup: d.subgroup || "",
    notes: d.notes || "",
    memberRole: d.member_role || "",
    gender: d.gender || "",
    phone: d.phone || "",
    birthDate: d.birth_date || "",
    baptismStatus: d.baptism_status || "해당없음",
    schoolOrWork: d.school_or_work || "",
    faithDuration: d.faith_duration || "",
    registrationDate: d.registration_date || "",
    pastoralVisitRequested: toBool(d.pastoral_visit_requested),
    isNewMember: toBool(d.is_new_member),
    newMemberEduWeek1: toBool(d.new_member_edu_week1),
    newMemberEduWeek2: toBool(d.new_member_edu_week2),
    kakaoId: d.kakao_id || "",
  };
}

export function rowToLog(e: Record<string, unknown>) {
  return {
    id: e.id,
    memberId: e.member_id,
    deviceId: e.device_id,
    name: e.name,
    group: e.group_name || "",
    subgroup: e.subgroup || "",
    date: e.date,
    time: e.time_str,
    ts: e.ts,
    locationVerified: toBool(e.location_verified),
    adminAdded: toBool(e.admin_added),
    manual: toBool(e.is_manual),
    bulk: toBool(e.is_bulk),
    guest: toBool(e.is_guest),
    firstVisit: toBool(e.first_visit),
    memberRole: e.member_role,
  };
}

export async function getDevsByName(db: D1Database, name: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT id FROM devices WHERE name = ?").bind(name).all<{ id: string }>();
  return (results || []).map((d) => d.id);
}

// Is `name` the 동산지기/부동산지기 of their 동산 (the display roster in config.dongsan_leaders)?
export function isDongsanLeaderName(
  name: string,
  group: string,
  subgroup: string,
  leaders: Cfg["dongsan_leaders"],
  summer: boolean,
): boolean {
  if (!name || !subgroup || !leaders) return false;
  const entry = summer ? leaders["합동"]?.[subgroup] : group ? leaders[group]?.[subgroup] : undefined;
  if (!entry) return false;
  return entry.leader === name || (Array.isArray(entry.subLeaders) && entry.subLeaders.includes(name));
}

export async function checkedToday(db: D1Database, name: string, today: string) {
  const dids = await getDevsByName(db, name);
  if (!dids.length) return null;
  const placeholders = dids.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM attendance_log WHERE device_id IN (${placeholders}) AND date = ? LIMIT 1`)
    .bind(...dids, today)
    .first<Record<string, unknown>>();
}

export async function countAtt(db: D1Database, name: string): Promise<number> {
  const dids = await getDevsByName(db, name);
  if (!dids.length) return 0;
  const placeholders = dids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT DISTINCT date FROM attendance_log WHERE device_id IN (${placeholders})`)
    .bind(...dids)
    .all<{ date: string }>();
  return (results || []).length;
}

export async function addAudit(db: D1Database, action: string, adminId: string, details: unknown): Promise<void> {
  try {
    const dev = await db.prepare("SELECT name FROM devices WHERE id = ?").bind(adminId).first<{ name: string }>();
    const detailsObj = typeof details === "string" ? { info: details } : details;
    await db
      .prepare("INSERT INTO audit_log (ts, action, admin_id, admin_name, details) VALUES (?, ?, ?, ?, ?)")
      .bind(Date.now(), action, adminId, dev?.name || adminId, toJson(detailsObj))
      .run();
  } catch {
    // best-effort — never block the calling mutation
  }
}

// Client IP as seen by the Worker: Cloudflare's own connecting-IP header first, falling
// back to X-Forwarded-For's first hop.
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xf = req.headers.get("x-forwarded-for") || "";
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "";
}

// Record a successful admin sign-in (login_log). The web app re-sends the saved password
// through /api/admin/verify on every page reload, so an identical repeat (same
// role+member+device+ip+method) within an hour is collapsed into the original entry.
// Best-effort: a logging failure must never block the login itself.
export async function addLoginLog(db: D1Database, req: Request, role: { role: string; memberId: string }): Promise<void> {
  try {
    const ip = clientIp(req);
    const deviceId = req.headers.get("x-device-id") || "";
    const method = (req.headers.get("authorization") || "").startsWith("Bearer ") ? "google" : "password";
    let memberName = "";
    if (role.memberId) {
      const m = await db.prepare("SELECT name FROM members WHERE id = ?").bind(role.memberId).first<{ name: string }>();
      memberName = m?.name || "";
    }
    const now = Date.now();
    const last = await db
      .prepare(
        "SELECT ts FROM login_log WHERE role = ? AND member_name = ? AND device_id = ? AND ip = ? AND method = ? ORDER BY ts DESC LIMIT 1",
      )
      .bind(role.role, memberName, deviceId, ip, method)
      .first<{ ts: number }>();
    if (last && now - last.ts < 60 * 60 * 1000) return;
    await db
      .prepare(
        "INSERT INTO login_log (ts, role, member_id, member_name, device_id, ip, method, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(now, role.role, role.memberId || null, memberName, deviceId, ip, method, req.headers.get("user-agent") || "")
      .run();
  } catch {
    // best-effort
  }
}

// When a real device is added for a member, it supersedes any ROSTER-… placeholder rows
// for that same name (seeded roster stubs with no real device). The placeholder's MEMBER
// IDENTITY is inherited onto the new personal device, its attendance history is migrated,
// and the placeholders are deleted so the member has a single canonical device record.
export async function supersedeRosterPlaceholders(db: D1Database, name: string, devId: string): Promise<void> {
  if (!name || !devId || devId.startsWith("ROSTER-")) return;
  const { results: rows } = await db
    .prepare("SELECT id, member_id FROM devices WHERE name = ? AND id LIKE 'ROSTER-%'")
    .bind(name)
    .all<{ id: string; member_id: string | null }>();
  const stubs = (rows || []).filter((r) => r.id !== devId);
  const rosterIds = stubs.map((r) => r.id);
  if (!rosterIds.length) return;

  const inheritedMember = stubs.map((r) => r.member_id).find((m) => m) || null;
  if (inheritedMember) {
    const curDev = await db.prepare("SELECT member_id FROM devices WHERE id = ?").bind(devId).first<{ member_id: string | null }>();
    if (!curDev?.member_id) {
      await db.prepare("UPDATE devices SET member_id = ? WHERE id = ?").bind(inheritedMember, devId).run();
    }
  }

  const placeholders = rosterIds.map(() => "?").join(",");
  await db.prepare(`UPDATE attendance_log SET device_id = ? WHERE device_id IN (${placeholders})`).bind(devId, ...rosterIds).run();
  await db.prepare(`DELETE FROM devices WHERE id IN (${placeholders})`).bind(...rosterIds).run();
}
