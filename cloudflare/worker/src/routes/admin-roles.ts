// member_roles admin — ported from supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok, readBody } from "../lib/http";
import { resolveAdmin } from "../lib/auth";
import { addAudit } from "../lib/helpers";

const app = new Hono<{ Bindings: Env }>();

// List all admin role grants (member_roles joined with member names). Super-admin only.
app.get("/roles", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const { results } = await db
    .prepare(
      `SELECT member_roles.member_id AS member_id, members.name AS name, member_roles.role AS role,
              member_roles.group_name AS group_name, member_roles.subgroup AS subgroup, member_roles.ministry AS ministry
       FROM member_roles LEFT JOIN members ON members.id = member_roles.member_id`,
    )
    .all<{ member_id: string; name: string | null; role: string; group_name: string | null; subgroup: string | null; ministry: string | null }>();
  return ok(c, {
    roles: (results || []).map((r) => ({
      memberId: r.member_id,
      name: r.name || "—",
      role: r.role,
      group: r.group_name || "",
      subgroup: r.subgroup || "",
      ministry: r.ministry || "",
    })),
  });
});

// Assign/replace a member's admin role (super-admin only). Upsert into member_roles.
app.post("/role/set", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const body = await readBody(c);
  const memberId = String(body.memberId || "");
  const newRole = String(body.role || "");
  if (!memberId || !newRole) return fail(c, 400, "memberId and role required");
  if (!["super_admin", "leader", "pastor", "welcoming"].includes(newRole)) return fail(c, 400, "Invalid role");
  const m = await db.prepare("SELECT name FROM members WHERE id = ?").bind(memberId).first<{ name: string }>();
  if (!m) return fail(c, 404, "Member not found");
  await db
    .prepare(
      `INSERT INTO member_roles (member_id, role, group_name, subgroup, ministry) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET role=excluded.role, group_name=excluded.group_name, subgroup=excluded.subgroup, ministry=excluded.ministry`,
    )
    .bind(memberId, newRole, String(body.group || ""), String(body.subgroup || ""), String(body.ministry || ""))
    .run();
  await addAudit(db, "admin-add", c.req.header("x-device-id") || "", m.name + " → " + newRole);
  return ok(c, { status: "ok" });
});

// Revoke a member's admin role (super-admin only). Refuses to remove the last super.
app.post("/role/remove", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const body = await readBody(c);
  const memberId = String(body.memberId || "");
  if (!memberId) return fail(c, 400, "memberId required");
  const tr = await db.prepare("SELECT role FROM member_roles WHERE member_id = ?").bind(memberId).first<{ role: string }>();
  if (!tr) return ok(c, { status: "ok" });
  if (tr.role === "super_admin") {
    const count = await db.prepare("SELECT COUNT(*) AS n FROM member_roles WHERE role = 'super_admin'").first<{ n: number }>();
    if ((count?.n || 0) <= 1) return fail(c, 400, "Cannot remove the last super admin");
  }
  const m = await db.prepare("SELECT name FROM members WHERE id = ?").bind(memberId).first<{ name: string }>();
  await db.prepare("DELETE FROM member_roles WHERE member_id = ?").bind(memberId).run();
  await addAudit(db, "admin-remove", c.req.header("x-device-id") || "", m?.name || memberId);
  return ok(c, { status: "ok" });
});

export default app;
