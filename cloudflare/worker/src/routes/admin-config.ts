// Settings / 동산 names / 동산지기 / 임원 config routes — ported from
// supabase/functions/attendance-api/index.ts.
import { Hono } from "hono";
import type { Env } from "../types";
import { fail, ok, readBody } from "../lib/http";
import { resolveAdmin } from "../lib/auth";
import { addAudit, getCfg, updateCfg } from "../lib/helpers";
import { toJson } from "../lib/db";

const app = new Hono<{ Bindings: Env }>();

// Adjustable check-in window + summer/demo/individual-checkin toggles + colors.
app.post("/settings", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const body = await readBody(c);
  const { checkinDays, checkinStartMin, checkinEndMin, announcement, summerMode, demoMode, individualCheckinEnabled, requireApproval, groupColors } = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (checkinDays !== undefined) patch.checkin_days = toJson(checkinDays);
  if (checkinStartMin !== undefined) patch.checkin_start_min = Number(checkinStartMin);
  if (checkinEndMin !== undefined) patch.checkin_end_min = Number(checkinEndMin);
  if (announcement !== undefined) patch.announcement = announcement;
  if (summerMode !== undefined) patch.summer_mode = summerMode ? 1 : 0;
  if (demoMode !== undefined) patch.demo_mode = demoMode ? 1 : 0;
  if (individualCheckinEnabled !== undefined) patch.individual_checkin_enabled = individualCheckinEnabled ? 1 : 0;
  if (requireApproval !== undefined) patch.require_approval = requireApproval ? 1 : 0;
  if (groupColors !== undefined && groupColors && typeof groupColors === "object") {
    const HEX = /^#[0-9a-fA-F]{6}$/;
    const clean: Record<string, string> = {};
    for (const [g, col] of Object.entries(groupColors as Record<string, unknown>)) if (typeof col === "string" && HEX.test(col)) clean[g] = col;
    patch.group_colors = toJson(clean);
  }
  await updateCfg(db, patch);
  return ok(c, { status: "ok" });
});

// 동산 names editor — read (super-admin only).
app.get("/dongsan-names", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const cfg = await getCfg(c.env.DB);
  return ok(c, { names: cfg.dongsan_names });
});

// 동산 names editor — write (super-admin only). Audited as a config-change.
app.post("/dongsan-names", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const body = await readBody(c);
  const names = body.names;
  if (!names || typeof names !== "object" || Array.isArray(names)) return fail(c, 400, "names map required");
  await updateCfg(db, { dongsan_names: toJson(names) });
  await addAudit(db, "config-change", c.req.header("x-device-id") || "", "동산 이름 수정");
  return ok(c, { status: "ok" });
});

// 동산지기/부동산지기 display roles — read (any verified admin).
app.get("/dongsan-leaders", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  const cfg = await getCfg(c.env.DB);
  return ok(c, { leaders: cfg.dongsan_leaders });
});

// 동산지기/부동산지기 editor — write one 동산's leader + sub-leaders (super-admin only).
app.post("/dongsan-leaders", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const body = await readBody(c);
  const group = String(body.group || "");
  const subgroup = String(body.subgroup || "");
  if (!group || !subgroup) return fail(c, 400, "group and subgroup required");
  const cfg = await getCfg(db);
  const leaders = cfg.dongsan_leaders;
  if (!leaders[group]) leaders[group] = {};
  leaders[group][subgroup] = { leader: String(body.leader || ""), subLeaders: Array.isArray(body.subLeaders) ? body.subLeaders : [] };
  await updateCfg(db, { dongsan_leaders: toJson(leaders) });
  await addAudit(db, "config-change", c.req.header("x-device-id") || "", "동산지기 수정: " + group + " " + subgroup);
  return ok(c, { status: "ok" });
});

// 임원 display-badge roster — read (any verified admin).
app.get("/officers", async (c) => {
  const role = await resolveAdmin(c.env.DB, c.req.raw, c.env);
  if (!role) return fail(c, 401, "Not authorized");
  const cfg = await getCfg(c.env.DB);
  return ok(c, { officers: cfg.officers });
});

// 임원 editor — replace the whole officer name list (super-admin only). Audited.
app.post("/officers", async (c) => {
  const db = c.env.DB;
  const role = await resolveAdmin(db, c.req.raw, c.env);
  if (role?.role !== "super_admin") return fail(c, 403, "Super admin required");
  const body = await readBody(c);
  const officers = body.officers;
  if (!Array.isArray(officers) || officers.some((n) => typeof n !== "string")) return fail(c, 400, "officers array required");
  const clean = Array.from(new Set(officers.map((n: string) => n.trim()).filter((n: string) => n.length > 0)));
  await updateCfg(db, { officers: toJson(clean) });
  await addAudit(db, "config-change", c.req.header("x-device-id") || "", "임원 수정");
  return ok(c, { status: "ok" });
});

export default app;
