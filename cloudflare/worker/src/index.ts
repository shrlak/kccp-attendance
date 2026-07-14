import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import publicRoutes from "./routes/public";
import rosterRoutes from "./routes/roster";
import adminAuthRoutes from "./routes/admin-auth";
import adminConfigRoutes from "./routes/admin-config";
import adminRolesRoutes from "./routes/admin-roles";
import adminMembersRoutes from "./routes/admin-members";
import adminAttendanceRoutes from "./routes/admin-attendance";
import adminPendingRoutes from "./routes/admin-pending";
import adminMiscRoutes from "./routes/admin-misc";

const app = new Hono<{ Bindings: Env }>();

// Same permissive CORS the Supabase edge function used — this is a parallel, non-prod
// environment with no fixed frontend origin yet.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Device-Id", "X-Admin-Password", "Authorization", "apikey"],
  }),
);

// Mirrors the original edge function's single top-level try/catch: any thrown error
// becomes a 400 with {error: message}.
app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 400));

app.route("/api", publicRoutes);
app.route("/api", rosterRoutes);
app.route("/api/admin", adminAuthRoutes);
app.route("/api/admin", adminConfigRoutes);
app.route("/api/admin", adminRolesRoutes);
app.route("/api/admin", adminMembersRoutes);
app.route("/api/admin", adminAttendanceRoutes);
app.route("/api/admin", adminPendingRoutes);
app.route("/api/admin", adminMiscRoutes);

export default app;
