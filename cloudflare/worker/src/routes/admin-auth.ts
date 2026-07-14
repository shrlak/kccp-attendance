// POST /api/admin/verify — ported from supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok } from "../lib/http";
import { resolveAdmin } from "../lib/auth";
import { addLoginLog } from "../lib/helpers";

const app = new Hono<{ Bindings: Env }>();

app.post("/verify", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  await addLoginLog(c.env.DB, c.req.raw, role);
  return ok(c, { role: role.role, group: role.group, subgroup: role.subgroup, ministry: role.ministry });
});

export default app;
