import { applyD1Migrations, env } from "cloudflare:test";

// @ts-expect-error TEST_MIGRATIONS is injected via vitest.config.ts, not part of Env
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
