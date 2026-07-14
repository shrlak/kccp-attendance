// Audit log, login log, backup/restore, and the Gemini card-OCR proxy — ported from
// supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok, readBody } from "../lib/http";
import { resolveAdmin } from "../lib/auth";
import { addAudit, getCfg, localDate, rowToDev, rowToLog, updateCfg } from "../lib/helpers";
import { toJson } from "../lib/db";
import { GEMINI_URL, buildGeminiBody, parseGeminiCard } from "../lib/gemini";

const app = new Hono<{ Bindings: Env }>();

app.get("/audit", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const limit = Math.min(parseInt(c.req.query("limit") || "100") || 100, 200);
  const { results } = await c.env.DB.prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?").bind(limit).all<Record<string, unknown>>();
  return ok(c, {
    log: (results || []).map((e) => ({ ts: e.ts, action: e.action, adminName: e.admin_name, details: JSON.parse((e.details as string) || "{}") })),
  });
});

app.get("/login-log", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const limit = Math.min(parseInt(c.req.query("limit") || "100") || 100, 500);
  const { results } = await c.env.DB.prepare("SELECT * FROM login_log ORDER BY ts DESC LIMIT ?").bind(limit).all<Record<string, unknown>>();
  return ok(c, {
    log: (results || []).map((e) => ({ ts: e.ts, role: e.role, memberName: e.member_name || "", deviceId: e.device_id || "", ip: e.ip || "", method: e.method || "password" })),
  });
});

// Full JSON snapshot (devices, attendance log, config, audit, pending). Reuses the
// legacy backup's shape for interchangeability with /api/admin/restore. `events` are
// omitted — that table wasn't ported (0 rows in prod, no live route used it).
app.get("/backup", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const dd = (await db.prepare("SELECT * FROM devices").all<Record<string, unknown>>()).results || [];
  const ld = (await db.prepare("SELECT * FROM attendance_log ORDER BY ts DESC").all<Record<string, unknown>>()).results || [];
  const ad = (await db.prepare("SELECT * FROM audit_log ORDER BY ts DESC").all<Record<string, unknown>>()).results || [];
  const pd = (await db.prepare("SELECT * FROM pending_registrations").all<Record<string, unknown>>()).results || [];
  const cfg = await getCfg(db);
  const devices: Record<string, unknown> = {};
  for (const d of dd) devices[d.id as string] = rowToDev(d);
  const bk = {
    version: 2,
    exportedAt: Date.now(),
    attendance: { devices, log: ld.map(rowToLog) },
    config: {
      dongsanNames: cfg.dongsan_names,
      checkinDays: cfg.checkin_days,
      checkinStartMin: cfg.checkin_start_min,
      checkinEndMin: cfg.checkin_end_min,
      dongsanLeaders: cfg.dongsan_leaders,
      requireApproval: cfg.require_approval,
      announcement: cfg.announcement,
      individualCheckinEnabled: cfg.individual_checkin_enabled,
    },
    audit: ad.map((e) => ({ ts: e.ts, action: e.action, adminId: e.admin_id, adminName: e.admin_name, details: JSON.parse((e.details as string) || "{}") })),
    pending: pd.map((p) => ({ deviceId: p.device_id, name: p.name, group: p.group_name, subgroup: p.subgroup, requestedAt: p.requested_at })),
  };
  return new Response(JSON.stringify(bk, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="kccp-backup-${localDate()}.json"` },
  });
});

// Destructive restore from a posted v2 snapshot — replaces devices, attendance_log, and
// config wholesale.
app.post("/restore", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const bk = await readBody(c);
  if (!bk.version || !bk.attendance) return fail(c, 400, "Invalid backup file");
  const attendance = bk.attendance as { devices?: Record<string, Record<string, unknown>>; log?: Record<string, unknown>[] };

  if (attendance.devices) {
    await db.prepare("DELETE FROM devices").run();
    const entries = Object.entries(attendance.devices);
    if (entries.length) {
      await db.batch(
        entries.map(([id, v]) =>
          db
            .prepare(
              `INSERT INTO devices (id, name, group_name, subgroup, notes, member_role, gender, phone, birth_date, baptism_status, school_or_work, faith_duration, registration_date, pastoral_visit_requested, is_new_member, new_member_edu_week1, new_member_edu_week2)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              id, v.name, v.group || "", v.subgroup || "", v.notes || "", v.memberRole || "",
              v.gender || "", v.phone || "", v.birthDate || null, v.baptismStatus || "해당없음",
              v.schoolOrWork || "", v.faithDuration || "", v.registrationDate || null,
              v.pastoralVisitRequested ? 1 : 0, v.isNewMember ? 1 : 0, v.newMemberEduWeek1 ? 1 : 0, v.newMemberEduWeek2 ? 1 : 0,
            ),
        ),
      );
    }
  }
  if (attendance.log) {
    await db.prepare("DELETE FROM attendance_log").run();
    if (attendance.log.length) {
      await db.batch(
        attendance.log.map((e) =>
          db
            .prepare(
              `INSERT INTO attendance_log (device_id, name, group_name, subgroup, date, time_str, ts, location_verified, admin_added, first_visit, is_manual, is_bulk, is_guest, member_role)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              e.deviceId, e.name, e.group || "", e.subgroup || "", e.date, e.time, e.ts,
              e.locationVerified ? 1 : 0, e.adminAdded ? 1 : 0, e.firstVisit ? 1 : 0,
              e.manual ? 1 : 0, e.bulk ? 1 : 0, e.guest ? 1 : 0, e.memberRole || null,
            ),
        ),
      );
    }
  }
  if (bk.config) {
    const cfgIn = bk.config as Record<string, unknown>;
    await updateCfg(db, {
      dongsan_names: toJson(cfgIn.dongsanNames),
      checkin_days: toJson(cfgIn.checkinDays || [0]),
      checkin_start_min: (cfgIn.checkinStartMin as number) ?? 780,
      checkin_end_min: (cfgIn.checkinEndMin as number) ?? 900,
      dongsan_leaders: toJson(cfgIn.dongsanLeaders || {}),
      require_approval: cfgIn.requireApproval ? 1 : 0,
      announcement: cfgIn.announcement || "",
      individual_checkin_enabled: cfgIn.individualCheckinEnabled ? 1 : 0,
    });
  }
  await addAudit(
    db,
    "restore",
    c.req.header("x-device-id") || "",
    "Restored backup from " + (bk.exportedAt ? new Date(bk.exportedAt as number).toLocaleString("ko-KR", { timeZone: "America/New_York" }) : "unknown"),
  );
  return ok(c, { status: "ok" });
});

// 새가족 등록 카드 photo extraction: proxies a downscaled card photo to Gemini, which
// reads the handwriting/checkboxes into structured JSON. Nothing is written to the DB
// here; the audit log only records size/type, never the extracted PII.
app.post("/extract-card", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const image = typeof body.image === "string" ? body.image : "";
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body.mediaType as string) ? (body.mediaType as string) : "image/jpeg";
  if (!image) return fail(c, 400, "image required");
  if (image.length > 8_000_000) return fail(c, 413, "Image too large — retake with a smaller photo");
  const key = c.env.GEMINI_API_KEY;
  if (!key) return fail(c, 500, "GEMINI_API_KEY not configured — set it with `wrangler secret put GEMINI_API_KEY`");
  const gr = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(buildGeminiBody(image, mediaType)),
  });
  if (!gr.ok) {
    const detail = await gr.text().catch(() => "");
    if (gr.status === 429) return fail(c, 429, "Gemini quota exceeded — wait a minute and retry");
    return fail(c, 502, "Gemini error " + gr.status + (detail ? ": " + detail.slice(0, 200) : ""));
  }
  const card = parseGeminiCard(await gr.json().catch(() => null));
  if (!card) return fail(c, 502, "Could not read card fields from the image");
  await addAudit(db, "extract-card", c.req.header("x-device-id") || "", mediaType + " | " + Math.round((image.length * 3) / 4 / 1024) + "KB");
  return ok(c, { status: "ok", card });
});

export default app;
