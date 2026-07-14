// End-to-end smoke test: drives the Hono app's fetch handler against the local
// (Miniflare) D1 instance migrated by test/apply-migrations.ts — the scripted flow the
// migration plan calls for (config -> self-register -> checkin -> admin verify -> roster
// -> a mutation -> attendance clear), exercising real SQL rather than mocks.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";

const SUPER_PASSWORD = "kccpadmin";

async function call(path: string, init?: RequestInit) {
  const res = await app.request(path, init, env);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe("public + admin route smoke test", () => {
  it("GET /api/health", async () => {
    const { status, body } = await call("/api/health");
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe("ok");
  });

  it("GET /api/config returns the seeded singleton config", async () => {
    const { status, body } = await call("/api/config");
    expect(status).toBe(200);
    expect(body).toMatchObject({ checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900 });
  });

  it("POST /api/checkin is time-restricted outside the check-in window (demo_mode off by default)", async () => {
    const { status, body } = await call("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "DEV-SMOKE-1" }),
    });
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe("time-restricted");
  });

  it("POST /api/self-register creates a device", async () => {
    const { status, body } = await call("/api/self-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "DEV-SMOKE-2", name: "테스트유저", group: "청년부", subgroup: "건영동산" }),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", name: "테스트유저" });
  });

  it("POST /api/admin/verify with the wrong password is rejected", async () => {
    const { status } = await call("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": "DEV-SMOKE-3" },
      body: JSON.stringify({}),
    });
    expect(status).toBe(401);
  });

  it("POST /api/admin/verify with SUPER_PASSWORD grants super_admin", async () => {
    const { status, body } = await call("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": "DEV-SMOKE-3", "X-Admin-Password": SUPER_PASSWORD },
      body: JSON.stringify({}),
    });
    expect(status).toBe(200);
    expect((body as { role: string }).role).toBe("super_admin");
  });

  describe("roster + member-checkin + attendance clear (as super_admin)", () => {
    const adminHeaders = { "Content-Type": "application/json", "X-Admin-Password": SUPER_PASSWORD };
    let memberId: string;

    beforeAll(async () => {
      const row = await env.DB.prepare("INSERT INTO members (id, name, group_name, subgroup) VALUES (?, ?, ?, ?) RETURNING id")
        .bind(crypto.randomUUID(), "출석테스트", "청년부", "건영동산")
        .first<{ id: string }>();
      memberId = row!.id;
    });

    it("GET /api/roster includes the seeded member", async () => {
      const { status, body } = await call("/api/roster", { headers: adminHeaders });
      expect(status).toBe(200);
      const members = (body as { members: { id: string }[] }).members;
      expect(members.some((m) => m.id === memberId)).toBe(true);
    });

    it("POST /api/admin/member-checkin marks the member present today", async () => {
      const { status, body } = await call("/api/admin/member-checkin", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ memberId }),
      });
      expect(status).toBe(200);
      expect((body as { status: string }).status).toBe("ok");

      // A second check-in the same day is idempotent ("already"), not a duplicate row.
      const again = await call("/api/admin/member-checkin", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ memberId }),
      });
      expect((again.body as { status: string }).status).toBe("already");
    });

    it("POST /api/admin/attendance/clear wipes attendance_log immediately for super_admin", async () => {
      const { status, body } = await call("/api/admin/attendance/clear", { method: "POST", headers: adminHeaders, body: "{}" });
      expect(status).toBe(200);
      expect((body as { status: string }).status).toBe("cleared");
      const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM attendance_log").first<{ n: number }>();
      expect(remaining?.n).toBe(0);
    });
  });
});
