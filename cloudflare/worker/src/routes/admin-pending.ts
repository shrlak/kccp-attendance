// Pending self-registrations (require_approval flow) — ported from
// supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok, readBody } from "../lib/http";
import { resolveAdmin } from "../lib/auth";
import { addAudit } from "../lib/helpers";

const app = new Hono<{ Bindings: Env }>();

app.get("/pending", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  const { results } = await c.env.DB.prepare("SELECT * FROM pending_registrations ORDER BY requested_at DESC").all<Record<string, unknown>>();
  return ok(c, {
    pending: (results || []).map((p) => ({
      deviceId: p.device_id,
      name: p.name,
      group: p.group_name || "",
      subgroup: p.subgroup || "",
      requestedAt: p.requested_at,
    })),
  });
});

// Approve a pending registration: find-or-create the member, link the device to it,
// then clear the pending row.
app.post("/pending/approve", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const deviceId = String(body.deviceId || "");
  if (!deviceId) return fail(c, 400, "deviceId required");
  const pr = await db.prepare("SELECT * FROM pending_registrations WHERE device_id = ?").bind(deviceId).first<{ device_id: string; name: string; group_name: string; subgroup: string }>();
  if (!pr) return fail(c, 404, "Not found in pending list");
  const mm = await db.prepare("SELECT id FROM members WHERE name = ? LIMIT 1").bind(pr.name).first<{ id: string }>();
  let memberId = mm?.id || null;
  if (!memberId) {
    const nm = await db.prepare("INSERT INTO members (id, name, group_name, subgroup) VALUES (?, ?, ?, ?) RETURNING id").bind(crypto.randomUUID(), pr.name, pr.group_name || "", pr.subgroup || "").first<{ id: string }>();
    memberId = nm?.id || null;
  }
  await db
    .prepare(
      `INSERT INTO devices (id, name, group_name, subgroup, member_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, group_name=excluded.group_name, subgroup=excluded.subgroup, member_id=excluded.member_id`,
    )
    .bind(pr.device_id, pr.name, pr.group_name || "", pr.subgroup || "", memberId)
    .run();
  await db.prepare("DELETE FROM pending_registrations WHERE device_id = ?").bind(deviceId).run();
  await addAudit(db, "pending-approve", c.req.header("x-device-id") || "", pr.name + " (" + pr.device_id + ")");
  return ok(c, { status: "ok" });
});

app.post("/pending/reject", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  if (role.role === "pastor") return fail(c, 403, "Read-only");
  const body = await readBody(c);
  const deviceId = String(body.deviceId || "");
  if (!deviceId) return fail(c, 400, "deviceId required");
  const pr = await db.prepare("SELECT name FROM pending_registrations WHERE device_id = ?").bind(deviceId).first<{ name: string }>();
  await db.prepare("DELETE FROM pending_registrations WHERE device_id = ?").bind(deviceId).run();
  await addAudit(db, "pending-reject", c.req.header("x-device-id") || "", (pr?.name || deviceId) + " (" + deviceId + ")");
  return ok(c, { status: "ok" });
});

export default app;
